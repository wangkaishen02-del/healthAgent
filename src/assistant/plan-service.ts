import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isAssistantDiscoveryCall,
  isAssistantBackendCall,
  isAssistantFinishCall,
  isAssistantUserInputCall,
  formatToolInvocation,
  normalizeAssistantModelToolCall,
  type AssistantDiscoveryCall,
  type AssistantBackendCall,
  type AssistantModelToolCall,
  type AssistantToolCall,
} from "./policy-query-assistant.ts";
import {
  getAssistantActionToolCatalog,
  getAssistantBackendToolCatalog,
  getAssistantControlToolCatalog,
  getAssistantDiscoveryToolCatalog,
  getCompactPageRegistration,
  getMenuPages,
  getNavigationRegistry,
} from "./page-registry.ts";
import { queryUnderwritingDb } from "../underwriting/prisma-service.ts";
import { queryClaimCasesDb } from "../claims/prisma-service.ts";
import { ExternalDataProtector, minimizeAssistantData, redactSensitiveText } from "./privacy.ts";
import { canAccessAssistantPage, filterAssistantMenus } from "./access-control.ts";
import { inspectClaimCaseForAssistant, summarizeClaimWorkQueueForAssistant } from "./backend-tools.ts";

export type LlmProvider = "ollama" | "deepseek";

const DEFAULT_LLM_PROVIDER: LlmProvider = process.env.LLM_PROVIDER === "deepseek" ? "deepseek" : "ollama";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const DEEPSEEK_URL = process.env.DEEPSEEK_URL ?? "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90000);
const MAX_AGENT_TURNS = 5;
const ASSISTANT_LOG_DIR = process.env.ASSISTANT_LOG_DIR?.trim() || join(process.cwd(), "logs");
const ASSISTANT_LOG_PATH = join(ASSISTANT_LOG_DIR, "assistant-llm.log");
const ASSISTANT_LOG_LEVEL = process.env.ASSISTANT_LOG_LEVEL === "redacted"
  ? "redacted"
  : process.env.ASSISTANT_LOG_LEVEL === "off"
    ? "off"
    : "metadata";

type OllamaMessage = { role: "system" | "user" | "assistant"; content: string };
type OllamaResponse = { message?: { content?: string } };
type DeepSeekResponse = { choices?: Array<{ message?: { content?: string | null } }> };
type LlmPayload = {
  reply?: string;
  thought?: string;
  recognized?: string[];
  decision?: "continue" | "finish";
  toolCalls?: AssistantModelToolCall[];
};

export type AssistantContinuationContext = {
  currentPagePath?: string[];
  currentPageRegistry?: unknown;
  history?: Array<{
    toolCalls: AssistantToolCall[];
  }>;
  lastOperationResult?: unknown;
  backendToolResults?: unknown[];
  actorRoles?: string[];
};

type AssistantLogEntry =
  | { type: "input"; runId: string; turn: number; provider: string; model: string; messages: OllamaMessage[] }
  | { type: "output"; runId: string; turn: number; provider: string; model: string; content: string; durationMs: number };

function formatJsonIfPossible(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content || "（模型未返回内容）";
  }
}

function formatAssistantLog(entry: AssistantLogEntry) {
  const header = [
    "=".repeat(84),
    `[assistant-llm] ${new Date().toISOString()} | run=${entry.runId} | turn=${entry.turn} | provider=${entry.provider} | model=${entry.model} | ${entry.type.toUpperCase()}`,
    "-".repeat(84),
  ];

  if (entry.type === "input") {
    const promptMetrics = getAssistantPromptMetrics(entry.messages.map((message) => message.content));
    const digest = createHash("sha256").update(entry.messages.map((message) => message.content).join("\n")).digest("hex").slice(0, 16);
    const messages = ASSISTANT_LOG_LEVEL === "redacted"
      ? entry.messages.map((message, index) => [
          `[${index + 1}] ${message.role.toUpperCase()}`,
          redactSensitiveText(message.content),
        ].join("\n"))
      : [];
    return [
      ...header,
      `prompt_chars=${promptMetrics.characters} | approx_tokens=${promptMetrics.approxTokens} | size=${promptMetrics.level} | sha256=${digest}`,
      ...messages,
      "=".repeat(84),
    ].join("\n");
  }

  return [
    ...header,
    `duration=${entry.durationMs}ms | output_chars=${[...entry.content].length} | sha256=${createHash("sha256").update(entry.content).digest("hex").slice(0, 16)}`,
    ...(ASSISTANT_LOG_LEVEL === "redacted" ? [formatJsonIfPossible(redactSensitiveText(entry.content))] : []),
    "=".repeat(84),
  ].join("\n");
}

export function getAssistantPromptMetrics(contents: string[]) {
  const content = contents.join("\n");
  const characters = [...content].length;
  const hanCharacters = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const approxTokens = Math.ceil(hanCharacters + (characters - hanCharacters) / 4);
  return {
    characters,
    approxTokens,
    level: characters >= 12_000 ? "large" as const : characters >= 8_000 ? "medium" as const : "compact" as const,
  };
}

async function writeAssistantLog(entry: AssistantLogEntry) {
  if (ASSISTANT_LOG_LEVEL === "off") return;
  const content = formatAssistantLog(entry);
  console.info(content);
  try {
    await mkdir(ASSISTANT_LOG_DIR, { recursive: true, mode: 0o700 });
    await appendFile(ASSISTANT_LOG_PATH, `${content}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // 日志写入失败不额外输出，保持控制台与日志文件内容一致。
  }
}

function buildContextualRules(userText: string, context?: AssistantContinuationContext) {
  const scope = `${userText}\n${context?.currentPagePath?.join("/") ?? ""}`.replace(/\s+/g, "");
  const rules: string[] = [];
  if (/(案件|CL[A-Z0-9-]{6,}|案件查询|受理立案)/i.test(scope)) {
    rules.push("案件号与保单号必须严格区分：CL 是案件号，GI 是保单号。仅查询案件时使用只读案件查询页；只有明确修改、提交或撤件时才进入受理立案。用户已给案件号时不得再索要其他定位条件。");
  }
  if (/CL[A-Z0-9-]{6,}/i.test(scope) && /(情况|进度|状态|资料|缺少|完整|OCR|下一步|能做什么|为什么)/i.test(scope)) {
    rules.push("用户询问指定案件的情况、资料、OCR、异常或下一步时，优先调用 inspect_claim_case；依据返回的 warnings、workflowActions 和 recommendedPage 回答，不猜测流程动作。仅在用户明确要求打开页面或办理时再执行页面动作。");
  }
  if (/(多少|数量|待办|积压|工作量|队列|各环节|OCR).{0,12}(案件|影像|任务)|(?:案件|影像|任务).{0,12}(多少|数量|待办|积压|队列)/i.test(scope)) {
    rules.push("用户询问整体案件环节数量、待办量或 OCR 队列时，调用 summarize_claim_work_queue 获取实时汇总，不打开列表后自行估算。");
  }
  if (/(有效期|出生日期|报案日期|申请人|领款人|受理立案)/.test(scope)) {
    rules.push("证件有效期已按角色分别注册。仅给年份时先交给页面保留原月日；页面返回 invalid_or_incomplete_date 才追问具体月日，禁止编造日期。");
  }
  if (/(全部|所有)/.test(scope)) {
    rules.push("用户明确说全部或所有即已确认查询范围，直接在目标页面执行重置和查询，不得调用缺少条件的后台查询工具，也不得重复确认。一次只能展示一个详情时只打开最符合目标的一个。");
  }
  if (/(放弃|丢弃|取消).{0,12}(未保存|修改|编辑)|(?:重置|清空).{0,8}(页面|表单|受理立案)/.test(scope)) {
    rules.push("放弃未保存修改或重置指定页面不需要定位业务对象；直接打开页面并执行重置或新建，不得索要案件、保单或人员条件。");
  }
  return rules.length ? `\n场景规则：\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}` : "";
}

export function buildSystemPrompt(userText = "", context?: AssistantContinuationContext) {
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `
你是健康险系统的页面操作 Agent。先依据注册信息理解能力，再选择页面动作。
只能输出 JSON，不输出 markdown、解释或代码块。
当前系统日期（Asia/Shanghai）：${currentDate}。

系统导航信息（无需调用工具）：
${JSON.stringify({ menus: filterAssistantMenus(getNavigationRegistry().menus, context?.actorRoles) })}

注册信息发现工具：
${JSON.stringify(getAssistantDiscoveryToolCatalog())}

页面操作工具：
${JSON.stringify(getAssistantActionToolCatalog())}

后台数据工具：
${JSON.stringify(getAssistantBackendToolCatalog())}

任务控制工具：
${JSON.stringify(getAssistantControlToolCatalog())}

工作规则：
1. 已有可信注册信息时直接执行；缺少或不确定时先查询注册信息。
2. 不猜测注册 ID；工具参数必须使用注册中心返回的菜单、页面、字段和动作 ID。
3. 可分多轮发现和操作，每轮根据上一步结果决定继续或结束。
4. 优先使用上下文中的历史动作和上次结果，不猜测更早结果。
5. 原始用户请求中如果包含明确的筛选值，执行查询动作前必须使用注册字段生成对应的 set_field；不能只在 recognized 中描述而省略字段动作。
6. 字段选择必须依据注册字段的标签、描述和所在区域，不要根据字段ID命名习惯猜测用途。
7. select 字段必须使用当前页面注册信息声明的 options 值；运行时选项会随页面上下文提供，不要自行创造选项值。
8. 可执行时返回页面操作，完成或无法继续时返回 finish_task。后台提供 itemId 时优先使用 click_list_item_action，不猜行号。
9. 每轮最多操作一个结果行；需要处理其他结果时等待执行后继续。
10. decision=continue 表示 Agent 还需要下一轮，decision=finish 表示结束本次任务。
11. 每轮必须输出 thought，简短说明当前判断和下一步计划；不要输出冗长逐字推理。
12. 数据变更中，打开、选中、填写都非完成；只有上次结果为 success=true 的 mutation_result 才可 finish_task，否则继续保存或确认。
13. 姓名、名称等可查询条件先用后台工具；结果唯一时直接继续，结果为空或无法消歧时才 ask_user，不得先索要系统可查编号。
14. 不得编造用户没有提供且系统结果中不存在的日期、地点、医院、诊断、账号等事实。页面已有默认值时保留默认值；可选字段缺失时保持为空。可以把用户原话整理为必填的简短事件描述，但不得添加原话没有表达的具体事实。
15. 当任务缺少系统无法查询且用户未提供的必填信息时，使用 ask_user 明确询问并列出 requestedFields。ask_user 会暂停任务，用户回答后继续原任务；不要用普通 reply 或 finish_task 代替追问。
16. 追问使用自然语言，不要求字段ID、枚举值或技术日期格式；内部自行转换。引用用户描述须保留原意，不把改写冒充原话。
${buildContextualRules(userText, context)}

输出结构：
{"thought":"不超过40字的当前判断与下一步计划","reply":"给用户的简短说明","recognized":["识别出的信息"],"decision":"continue 或 finish","toolCalls":[{"tool":"工具名","args":{}}]}
`.trim();
}

function tryParseJson(content: string): LlmPayload | null {
  try {
    return JSON.parse(content) as LlmPayload;
  } catch {
    const matched = content.match(/\{[\s\S]*\}/);
    if (!matched) return null;
    try { return JSON.parse(matched[0]) as LlmPayload; } catch { return null; }
  }
}

function normalizePayload(payload: LlmPayload) {
  if (!payload || typeof payload.reply !== "string" || !Array.isArray(payload.toolCalls)) return null;
  const toolCalls = payload.toolCalls
    .map(normalizeAssistantModelToolCall)
    .filter((call): call is AssistantModelToolCall => call !== null);
  const recognized = Array.isArray(payload.recognized)
    ? payload.recognized.filter((item): item is string => typeof item === "string")
    : [];
  return {
    reply: payload.reply,
    thought: typeof payload.thought === "string" ? payload.thought.slice(0, 120) : undefined,
    recognized,
    decision: payload.decision === "continue" ? "continue" as const : "finish" as const,
    toolCalls,
  };
}

function executeDiscovery(call: AssistantDiscoveryCall, roles: readonly string[] = []) {
  if (call.tool === "get_navigation_registry") return { menus: filterAssistantMenus(getNavigationRegistry().menus, roles) };
  if (call.tool === "get_menu_pages") {
    const menu = getMenuPages(call.args.menuId);
    if (!menu) return { error: "menu_not_found" };
    return filterAssistantMenus([menu], roles)[0] ?? { error: "menu_forbidden" };
  }
  if (!canAccessAssistantPage(call.args.pageId, roles)) return { error: "page_forbidden" };
  return getCompactPageRegistration(call.args.pageId) ?? { error: "page_not_found" };
}

export async function executeAssistantBackendTool(call: AssistantBackendCall, roles: readonly string[] = []) {
  if (call.tool === "query_underwriting") {
    const result = await queryUnderwritingDb(call.args);
    return {
      type: "underwriting_query_result",
      ...result,
      resolvedFields: result.total === 1 ? ["policyNo", "insuredName", "insuredIdNo"] : [],
    };
  }
  if (call.tool === "query_claim_cases") {
    const result = await queryClaimCasesDb(call.args);
    return {
      type: "claim_case_query_result",
      total: result.total,
      items: result.items.map((item) => {
        const insured = item.parties.find((party) => party.role === "insured");
        return {
          itemId: item.id,
          caseNo: item.caseNo,
          status: item.status,
          policyNo: item.policyNo,
          insuredName: insured?.name,
          insuredIdNo: insured?.idNo,
          event: {
            itemId: item.event.id,
            eventNo: item.event.eventNo,
            eventType: item.event.eventType,
            occurredDate: item.event.occurredDate,
            description: item.event.description,
          },
        };
      }),
      resolvedFields: result.total === 1 ? ["caseId", "caseNo", "policyNo", "insuredName", "insuredIdNo", "eventId"] : [],
    };
  }
  if (call.tool === "inspect_claim_case") return inspectClaimCaseForAssistant(call.args.caseNo, roles);
  if (call.tool === "summarize_claim_work_queue") return summarizeClaimWorkQueueForAssistant();
  return { type: "backend_tool_error", reason: "tool_not_supported" };
}

function formatDiscoveryStep(call: AssistantDiscoveryCall) {
  return formatToolInvocation(call.tool, call.args);
}

function hasExplicitQueryCondition(userText: string) {
  const normalized = userText.replace(/\s+/g, "");
  if (/(全部保单|所有保单|刷新结果|重新查询|重置条件)/.test(normalized)) return false;
  return /(保单|投保|被保人|姓名|证件|状态)/.test(normalized) && /[\u4e00-\u9fa5]{2,}/.test(normalized);
}

function hasSearchAction(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  return plan.toolCalls.some((call) => call.tool === "click_button" && call.args.actionId === "search");
}

function hasSetFieldAction(plan: NonNullable<ReturnType<typeof normalizePayload>>, context?: AssistantContinuationContext) {
  const currentPlanHasField = plan.toolCalls.some((call) => call.tool === "set_field");
  const previousPlanHasField = context?.history?.some((item) => item.toolCalls.some((call) => call.tool === "set_field")) ?? false;
  return currentPlanHasField || previousPlanHasField;
}

function hasMultipleResultActions(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  return plan.toolCalls.filter((call) => call.tool === "click_list_row_action" || call.tool === "click_list_item_action").length > 1;
}

function hasForbiddenPageAction(plan: NonNullable<ReturnType<typeof normalizePayload>>, roles: readonly string[] = []) {
  return plan.toolCalls.some((call) => "pageId" in call.args
    && typeof call.args.pageId === "string"
    && !canAccessAssistantPage(call.args.pageId, roles));
}

function misusesClaimCaseNoAsPolicyField(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  return plan.toolCalls.some((call) => call.tool === "set_field"
    && call.args.fieldId === "policyNo"
    && call.args.value.trim().toUpperCase().startsWith("CL"));
}

function asksForRedundantClaimLocator(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const hasCaseNo = /CL[A-Z0-9-]{6,}/i.test(userText);
  const asksForLocator = plan.toolCalls.filter(isAssistantUserInputCall).some((call) =>
    call.args.requestedFields.some((field) => ["caseNo", "policyNo", "insuredName", "insuredIdNo"].includes(field)),
  );
  if (!hasCaseNo || !asksForLocator) return false;
  const claimWasNotFound = backendToolResults.some((result) => result && typeof result === "object"
    && (result as { type?: unknown }).type === "claim_case_query_result"
    && (result as { total?: unknown }).total === 0);
  return !claimWasNotFound;
}

function asksForResolvedFields(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const resolvedFields = new Set(
    backendToolResults.flatMap((result) => {
      if (!result || typeof result !== "object") return [];
      const fields = (result as { resolvedFields?: unknown }).resolvedFields;
      return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
    }),
  );
  return plan.toolCalls
    .filter(isAssistantUserInputCall)
    .some((call) => call.args.requestedFields.some((field) => resolvedFields.has(field)));
}

export function isDataMutationRequest(userText: string) {
  const normalized = userText.replace(/\s+/g, "");
  const discardsUnsavedWork = /(放弃|丢弃|取消).{0,12}(未保存|修改|编辑)|(?:重置|清空).{0,8}(页面|表单|受理立案)/.test(normalized);
  if (discardsUnsavedWork) return false;
  const explicitlyReadOnly = /(不要|无需|不需要|禁止|不做)(新增|创建|配置|修改|更新|删除|撤件|提交|保存|关联|上传)|(?:只|仅)(?:查询|查看|打开)/.test(normalized);
  if (explicitlyReadOnly) return false;
  if (/(新增|创建|立案|修改|更新|删除|撤件|提交|保存|关联|上传|办理|登记)/.test(normalized)) return true;
  return /(配置|设置|调整|维护).{0,12}(参数|免赔额|赔付比例|赔付限额|等待期|年度限额)/.test(normalized);
}

function prematurelyStopsBeforeLookup(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context?: AssistantContinuationContext,
) {
  if (!isDataMutationRequest(userText)) return false;
  if (plan.toolCalls.some(isAssistantUserInputCall)) return false;
  const lastResult = context?.lastOperationResult as { type?: unknown; success?: unknown; operation?: unknown; reason?: unknown } | undefined;
  if (lastResult?.type === "mutation_result" && lastResult.success === true && lastResult.operation !== "create_event") return false;
  if (lastResult?.type === "operation_error" && typeof lastResult.reason === "string" && /(ambiguous|not_found)/.test(lastResult.reason)) return false;
  const hasDiscovery = plan.toolCalls.some(isAssistantDiscoveryCall);
  const hasExecutableAction = plan.toolCalls.some((call) => !isAssistantDiscoveryCall(call) && !isAssistantFinishCall(call));
  const hasCompletionAction = plan.toolCalls.some((call) => {
    if (isAssistantDiscoveryCall(call) || isAssistantFinishCall(call)) return false;
    if (call.tool !== "click_button") return false;
    return /^(save_|submit_|cancel_|delete_|remove_)/.test(call.args.actionId) && call.args.actionId !== "create_event";
  });
  if (!hasExecutableAction && !hasDiscovery) return true;
  return plan.decision === "finish" && !hasDiscovery && !hasCompletionAction;
}

function formatLastOperationResult(result: unknown) {
  const serialized = JSON.stringify(result ?? null);
  if (!result || typeof result !== "object") return serialized;

  const candidate = result as {
    type?: unknown;
    total?: unknown;
    returnedItemCount?: unknown;
    contextLimit?: unknown;
    truncated?: unknown;
    matchedPolicyCount?: unknown;
    returnedPolicyCount?: unknown;
    policyListContextLimit?: unknown;
    policyListTruncated?: unknown;
  };
  if (candidate.type === "list_result" && typeof candidate.total === "number") {
    const returnedCount = typeof candidate.returnedItemCount === "number" ? candidate.returnedItemCount : 0;
    const limit = typeof candidate.contextLimit === "number" ? candidate.contextLimit : returnedCount;
    return `${serialized}

列表结果上下文说明：本次完整命中 ${candidate.total} 条。items 仅提供前 ${returnedCount} 条（最大 ${limit} 条）作为上下文${candidate.truncated === true ? "，仍有其他结果未传入" : "，已包含全部结果"}。不得把 items 长度当作完整结果数。`;
  }
  if (candidate.type !== "policy_search" || typeof candidate.matchedPolicyCount !== "number") return serialized;

  const returnedCount = typeof candidate.returnedPolicyCount === "number" ? candidate.returnedPolicyCount : 0;
  const limit = typeof candidate.policyListContextLimit === "number" ? candidate.policyListContextLimit : returnedCount;
  const truncated = candidate.policyListTruncated === true;
  return `${serialized}

查询结果上下文说明：本次完整命中 ${candidate.matchedPolicyCount} 条保单。为限制模型上下文，policies 仅提供前 ${returnedCount} 条（最大 ${limit} 条）作为样本${truncated ? "，仍有其他命中结果未传入" : "，已包含全部命中结果"}。不得把 policies 的长度当作完整结果数，也不要臆测未传入的保单。`;
}

function getTerminalOperationError(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const candidate = result as { type?: unknown; reason?: unknown };
  if (candidate.type !== "operation_error" || typeof candidate.reason !== "string") return null;
  if (candidate.reason === "calculation_data_locked") {
    return "案件已完成理算，当前理算数据已锁定。如需新增或修改，请先执行理算回退。";
  }
  if (candidate.reason === "read_only_page") {
    return "当前页面为只读页面，不能新增或修改数据。请进入对应的业务处理页面后再操作。";
  }
  return null;
}

function getLlmIdentity(provider: LlmProvider) {
  if (provider === "ollama") return { provider, model: OLLAMA_MODEL };
  return { provider, model: DEEPSEEK_MODEL };
}

function explicitRequestedPage(userText: string) {
  const text = userText.replace(/\s+/g, "");
  if (!/(打开|进入|切换|前往)/.test(text)) return null;
  if (/受理立案/.test(text)) return "claim_registration";
  if (/录入与理算|录入理算|理算页面/.test(text)) return "claim_entry_calculation";
  if (/审核结案|审核页面/.test(text)) return "claim_review_completion";
  if (/理算配置|配置页面/.test(text)) return "calculation_config";
  return null;
}

async function callOllama(messages: OllamaMessage[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, format: "json", messages, options: { temperature: 0 } }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`ollama_http_${response.status}`);
    const data = (await response.json()) as OllamaResponse;
    const content = data.message?.content?.trim() ?? "";
    return { content, parsed: tryParseJson(content), durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function callDeepSeek(messages: OllamaMessage[], protector: ExternalDataProtector) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("deepseek_api_key_missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        stream: false,
        temperature: 0,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: messages.map((message) => ({ ...message, content: protector.protect(message.content) })),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
    const data = (await response.json()) as DeepSeekResponse;
    const content = protector.restore(data.choices?.[0]?.message?.content?.trim() ?? "");
    return { content, parsed: tryParseJson(content), durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function callLlm(provider: LlmProvider, messages: OllamaMessage[], protector: ExternalDataProtector) {
  return provider === "deepseek" ? callDeepSeek(messages, protector) : callOllama(messages);
}

export async function requestAgentPlan(userText: string, provider: LlmProvider, context?: AssistantContinuationContext) {
  const requestedPage = explicitRequestedPage(userText);
  if (requestedPage && !canAccessAssistantPage(requestedPage, context?.actorRoles)) {
    return {
      ok: true as const,
      rawReplies: [],
      plan: {
        thought: "目标页面超出当前角色权限",
        reply: "当前账号没有访问该页面或执行该业务环节的权限，请联系管理员调整角色。",
        recognized: ["目标页面超出当前角色权限"],
        decision: "finish" as const,
        toolCalls: [] as AssistantToolCall[],
        discoverySteps: [],
        discoveryResults: [],
        backendToolResults: context?.backendToolResults ?? [],
      },
    };
  }
  const terminalErrorReply = getTerminalOperationError(context?.lastOperationResult);
  if (terminalErrorReply) {
    return {
      ok: true as const,
      rawReplies: [],
      plan: {
        thought: "当前操作受业务状态限制，停止重复执行",
        reply: terminalErrorReply,
        recognized: ["当前操作不可执行"],
        decision: "finish" as const,
        toolCalls: [] as AssistantToolCall[],
        discoverySteps: [],
        discoveryResults: [],
        backendToolResults: context?.backendToolResults ?? [],
      },
    };
  }
  const runId = randomUUID().slice(0, 8);
  const llm = getLlmIdentity(provider);
  const protector = new ExternalDataProtector();
  const minimizedContext = context ? minimizeAssistantData({
    history: context.history?.slice(-8),
    currentPageRegistry: context.currentPageRegistry,
    lastOperationResult: context.lastOperationResult,
    backendToolResults: context.backendToolResults,
    currentPagePath: context.currentPagePath,
    actorRoles: context.actorRoles,
  }) as AssistantContinuationContext : undefined;
  const userMessage = context
    ? `${userText}

当前 Agent 状态如下，请只根据以下信息决定下一步：

历史操作记录：
${JSON.stringify(minimizedContext?.history ?? [])}

当前页面注册信息：
${JSON.stringify(minimizedContext?.currentPageRegistry ?? null)}

上一次操作结果：
${formatLastOperationResult(minimizedContext?.lastOperationResult)}

本任务已取得的后台工具结果：
${JSON.stringify(minimizedContext?.backendToolResults ?? [])}

当前页面路径：
${minimizedContext?.currentPagePath?.join(" -> ") ?? "未知"}`
    : userText;
  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt(userText, context) },
    { role: "user", content: userMessage },
  ];
  const discoverySteps: string[] = [];
  const discoveredResources: unknown[] = [];
  const backendToolResults: unknown[] = [...(context?.backendToolResults ?? [])];
  const rawReplies: string[] = [];
  let lastPlan: ReturnType<typeof normalizePayload> = null;

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    await writeAssistantLog({ type: "input", runId, turn, ...llm, messages });
    const result = await callLlm(provider, messages, protector);
    rawReplies.push(result.content);
    await writeAssistantLog({
      type: "output",
      runId,
      turn,
      ...llm,
      content: result.content,
      durationMs: result.durationMs,
    });
    if (!result.parsed) return { ok: false as const, reason: "invalid_plan" as const, rawReplies };
    const plan = normalizePayload(result.parsed);
    if (!plan) return { ok: false as const, reason: "invalid_plan" as const, rawReplies };
    const rawToolCallCount = Array.isArray(result.parsed.toolCalls) ? result.parsed.toolCalls.length : 0;
    if (rawToolCallCount > plan.toolCalls.length) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：计划中包含参数缺失、未注册或不可执行的工具调用。后台查询工具至少需要一个明确条件；查询全部数据时应使用目标页面的 reset 和 search。请根据工具定义修正，并只输出新的 JSON 计划。",
      });
      continue;
    }
    lastPlan = plan;

    if (hasForbiddenPageAction(plan, context?.actorRoles)) {
      return {
        ok: true as const,
        rawReplies,
        plan: {
          reply: "当前账号没有访问该页面或执行该业务环节的权限，请联系管理员调整角色。",
          recognized: ["目标页面超出当前角色权限"],
          decision: "finish" as const,
          toolCalls: [] as AssistantToolCall[],
          discoverySteps,
          discoveryResults: discoveredResources,
          backendToolResults,
        },
      };
    }

    if (asksForResolvedFields(plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前 ask_user 请求的字段已经由后台工具唯一确定。请直接使用后台结果填写页面，不要再次询问用户；仅追问后台结果和用户原始输入中都不存在、且完成任务必需的信息。",
      });
      continue;
    }

    if (misusesClaimCaseNoAsPolicyField(plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：CL 开头的是案件号，不是保单号，禁止填写到保单号字段。只读查询应在案件查询页填写 caseNo 并查看详情；修改、提交或撤件任务才使用 query_claim_cases 定位并打开受理立案中的案件。",
      });
      continue;
    }

    if (asksForRedundantClaimLocator(userText, plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：用户已经提供案件号，案件号就是充分定位条件，不能再询问保单号、姓名或证件号。只读查询请直接在案件查询页按案件号检索并查看详情；维护任务则使用 query_claim_cases 定位后打开受理立案并继续。",
      });
      continue;
    }

    if (prematurelyStopsBeforeLookup(userText, plan, context)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：这是尚未完成的数据变更任务。查询、打开页面、锁定对象、填写字段或新增关联对象都只是中间步骤，不能 decision=finish。请利用上一次结果继续执行，直到最终保存动作明确返回成功；如果尚未定位对象，先根据用户提供的姓名或名称执行系统查询。当前计划必须 decision=continue，除非本轮包含最终保存动作。",
      });
      continue;
    }

    if (hasExplicitQueryCondition(userText) && hasSearchAction(plan) && !hasSetFieldAction(plan, context)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：用户请求包含明确查询条件，但当前计划在没有 set_field 的情况下直接执行 search。请根据页面注册信息补全对应的 set_field，再输出新的 JSON 计划；不要自行结束任务。",
      });
      continue;
    }

    if (hasMultipleResultActions(plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前页面一次只能打开一个详情区域，但当前计划包含多个列表对象操作。请只选择一个最符合当前用户目标的列表操作，执行后等待结果再决定是否继续；后台结果提供 itemId 时优先使用 click_list_item_action，不要一次返回多个列表操作。",
      });
      continue;
    }

    const discoveryCalls = plan.toolCalls.filter(isAssistantDiscoveryCall);
    const backendCalls = plan.toolCalls.filter(isAssistantBackendCall);
    const userInputCalls = plan.toolCalls.filter(isAssistantUserInputCall);
    const finishCalls = plan.toolCalls.filter(isAssistantFinishCall);
    const actionCalls = plan.toolCalls.filter((call): call is AssistantToolCall => !isAssistantDiscoveryCall(call) && !isAssistantBackendCall(call) && !isAssistantUserInputCall(call) && !isAssistantFinishCall(call));
    if (discoveryCalls.length === 0 && backendCalls.length === 0) {
      const userInputRequest = userInputCalls[0]?.args;
      return {
        ok: true as const,
        rawReplies,
        plan: {
          ...plan,
          toolCalls: actionCalls,
          decision: finishCalls.length > 0 ? "finish" : plan.decision,
          userInputRequest,
          discoverySteps: userInputRequest ? [...discoverySteps, formatToolInvocation("ask_user", userInputRequest)] : discoverySteps,
          discoveryResults: discoveredResources,
          backendToolResults,
        },
      };
    }

    const discoveryResults = discoveryCalls.map((call) => executeDiscovery(call, context?.actorRoles));
    const forbiddenDiscovery = discoveryResults.some((result) => result && typeof result === "object"
      && ["page_forbidden", "menu_forbidden"].includes(String((result as { error?: unknown }).error)));
    if (forbiddenDiscovery) {
      return {
        ok: true as const,
        rawReplies,
        plan: {
          reply: "当前账号没有访问该页面或执行该业务环节的权限，请联系管理员调整角色。",
          recognized: ["目标页面超出当前角色权限"],
          decision: "finish" as const,
          toolCalls: [] as AssistantToolCall[],
          discoverySteps,
          discoveryResults: [...discoveredResources, ...discoveryResults],
          backendToolResults,
        },
      };
    }
    const backendResults = await Promise.all(backendCalls.map((call) => executeAssistantBackendTool(call, context?.actorRoles)));
    backendToolResults.push(...backendResults);
    discoveredResources.push(...discoveryResults);
    discoveryCalls.forEach((call) => discoverySteps.push(formatDiscoveryStep(call)));
    backendCalls.forEach((call) => discoverySteps.push(formatToolInvocation(call.tool, call.args)));
    messages.push({ role: "assistant", content: result.content });
    messages.push({
      role: "user",
      content: `工具执行结果如下：${JSON.stringify(minimizeAssistantData([...discoveryResults, ...backendResults]))}。请根据这些结果继续下一步，只输出新的 JSON 计划。`,
    });
  }

  return {
    ok: true as const,
    rawReplies,
    plan: {
      reply: lastPlan?.reply ?? "已达到本次 Agent 的最大执行轮次。",
      recognized: lastPlan?.recognized ?? [],
      decision: "finish" as const,
      toolCalls: [] as AssistantToolCall[],
      discoverySteps,
      discoveryResults: discoveredResources,
      backendToolResults,
    },
  };
}

export async function createAssistantPlan(body: {
    text?: string;
    provider?: unknown;
    context?: AssistantContinuationContext;
  } | null) {
  const text = body?.text?.trim();
  if (!text) return { status: 400, body: { message: "text is required" } };
  const provider = body?.provider ?? DEFAULT_LLM_PROVIDER;
  if (provider !== "ollama" && provider !== "deepseek") {
    return { status: 400, body: { message: "unsupported_llm_provider" } };
  }

  try {
    const result = await requestAgentPlan(text, provider, body?.context);
    if (!result.ok) {
      return { status: 502, body: { message: "llm_invalid_plan", detail: "本地模型返回了无法解析的执行计划。" } };
    }
    return { status: 200, body: result.plan };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? `模型响应超时（>${Math.round(LLM_TIMEOUT_MS / 1000)} 秒）。`
      : error instanceof Error && error.message === "deepseek_api_key_missing"
        ? "未配置 DEEPSEEK_API_KEY，无法调用 DeepSeek。"
        : error instanceof Error
          ? error.message
          : "模型当前不可用。";
    return { status: 502, body: { message: "llm_unavailable", detail } };
  }
}
