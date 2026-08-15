import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isAssistantBackendCall,
  isAssistantFinishCall,
  isAssistantUserInputCall,
  formatToolInvocation,
  normalizeAssistantModelToolCall,
  type AssistantBackendCall,
  type AssistantModelToolCall,
  type AssistantPlan,
  type AssistantToolCall,
} from "./policy-query-assistant.ts";
import {
  getAssistantActionToolCatalog,
  getAssistantBackendToolCatalog,
  getAssistantControlToolCatalog,
  getCompactPageRegistration,
  getNavigationRegistry,
} from "./page-registry.ts";
import { queryUnderwritingDb } from "../underwriting/prisma-service.ts";
import { queryClaimCasesDb } from "../claims/prisma-service.ts";
import { ExternalDataProtector, minimizeAssistantData, redactSensitiveText } from "./privacy.ts";
import { canAccessAssistantPage, filterAssistantMenus } from "./access-control.ts";
import { inspectClaimCaseForAssistant, summarizeClaimWorkQueueForAssistant } from "./backend-tools.ts";
import type { AssistantMemorySnapshot } from "./memory-service.ts";

export type LlmProvider = "ollama" | "deepseek";

const DEFAULT_LLM_PROVIDER: LlmProvider = process.env.LLM_PROVIDER === "ollama" ? "ollama" : "deepseek";
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
  actionExplanation?: string;
  planStep?: number;
  recognized?: string[];
  decision?: "continue" | "finish";
  toolCalls?: AssistantModelToolCall[];
};

type TaskPlanPayload = {
  shouldPlan?: unknown;
  steps?: unknown;
  intent?: unknown;
};

export type AssistantTaskIntentMode = "read" | "write" | "mixed" | "navigate" | "explain" | "unknown";
export type AssistantTaskIntent = {
  mode: AssistantTaskIntentMode;
  summary: string;
  objectives: string[];
};
export type AssistantTaskBlueprint = {
  intent: AssistantTaskIntent;
  shouldPlan: boolean;
  steps: string[];
};

export type AssistantContinuationContext = {
  currentPageRegistry?: unknown;
  history?: Array<{
    toolCalls: AssistantToolCall[];
  }>;
  lastOperationResult?: unknown;
  backendToolResults?: unknown[];
  actorRoles?: string[];
  memory?: AssistantMemorySnapshot;
  taskPlan?: string[];
  taskIntent?: AssistantTaskIntent;
  currentPlanStep?: number;
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
  const scope = userText.replace(/\s+/g, "");
  const rules: string[] = [];
  if (/^(?:请)?(?:帮我)?(?:处理|办理|操作)(?:一下)?[。！!？?]*$/.test(userText.replace(/\s+/g, ""))) {
    rules.push("用户没有说明要处理的业务或对象。立即使用 ask_user 追问具体任务，requestedFields 使用 taskDescription；不要反复发现注册信息，也不要自行选择页面。");
  }
  if (/(案件|CL[A-Z0-9-]{6,}|案件查询|受理立案)/i.test(scope)) {
    rules.push("案件号与保单号必须严格区分：CL 是案件号，GI 是保单号。仅查询案件时使用只读案件查询页；只有明确修改、提交或撤件时才进入受理立案。用户已给案件号时不得再索要其他定位条件。");
  }
  if (/CL[A-Z0-9-]{6,}/i.test(scope) && /(情况|进度|状态|资料|缺少|完整|OCR|下一步|能做什么|为什么)/i.test(scope)) {
    rules.push("用户询问指定案件的情况、资料、OCR、异常或下一步时，优先调用 inspect_claim_case；依据 warnings 判断资料问题，依据 businessNextActions 说明业务上可继续的方向，依据 workflowActions 判断当前账号能执行什么。businessNextActions 非空但 workflowActions 为空表示存在业务下一步但当前账号无权限，不能说成没有下一步。仅在用户明确要求打开页面或办理时再执行页面动作。");
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
  if (/(投保单位|公司|企业|集团).{0,20}(保单|投保)|(?:保单|投保).{0,20}(投保单位|公司|企业|集团)/.test(scope)) {
    rules.push("公司或投保单位名称只能用于保单查询页的 applicantName 字段，不得作为 query_underwriting 的 insuredName；insuredName 只接受自然人被保人姓名。页面查询结果已经返回保单号、状态、保障期限和被保人数时，应直接据此比较并回答，不要再调用后台承保查询。");
  }
  if (/(放弃|丢弃|取消).{0,12}(未保存|修改|编辑)|(?:重置|清空).{0,8}(页面|表单|受理立案)/.test(scope)) {
    rules.push("放弃未保存修改或重置指定页面不需要定位业务对象；直接打开页面并执行重置或新建，不得索要案件、保单或人员条件。");
  }
  return rules.length ? `\n场景规则：\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}` : "";
}

export function buildSystemPrompt(userText = "", context?: AssistantContinuationContext) {
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const navigation = filterAssistantMenus(getNavigationRegistry().menus, context?.actorRoles).map((menu) => ({
    menuId: menu.menuId,
    label: menu.label,
    pages: menu.pages.map((page) => ({ pageId: page.pageId, label: page.label })),
  }));
  const compactTools = <T extends { description: string }>(tools: T[]) => tools.map(({ description: _description, ...tool }) => tool);
  return `
你是团体健康险理赔平台的执行 Agent。系统管理保单、保障计划、险种责任、被保人、理赔案件、影像 OCR、票据、理算、审核、结案与撤件；所有数据变更受角色权限和案件状态机约束。先依据注册信息理解能力，再选择页面动作。
只能输出 JSON，不输出 markdown、解释或代码块。
当前系统日期（Asia/Shanghai）：${currentDate}。

系统导航信息（无需调用工具）：
${JSON.stringify({ menus: navigation })}

页面操作工具：
${JSON.stringify(compactTools(getAssistantActionToolCatalog()))}

后台数据工具：
${JSON.stringify(compactTools(getAssistantBackendToolCatalog()))}

任务控制工具：
${JSON.stringify(compactTools(getAssistantControlToolCatalog()))}

工作规则：
1. 以“本任务意图”的 mode、summary、objectives 为边界并遵循行动计划；可按结果调整，但不能改变读写性质或跳过必要步骤。
2. 只用当前注册的工具、页面、字段、动作和选项。一轮执行一个有依赖的下一步；互不依赖的只读后台查询可并行。缺少事实先查询，不猜 ID、日期、金额等业务值。
3. 参数说明词不是业务值；未提供的可选参数必须省略。CL 是案件号，GI 是保单号，不得混用。
4. 已有姓名或编号时先后台定位；唯一结果继续，空结果或确实无法消歧才 ask_user。status 可单独查询案件；“最近更新”使用 sortBy=updatedAt、sortOrder=desc、limit=1。
5. 排序、最大值和最近一笔由 Agent 根据结果判断，不询问用户。total=0 的回复必须保留 appliedFilters 范围，不得扩大结论。
6. 数据变更必须“唯一定位→状态与权限校验→必要确认→执行→复核”，仅 mutation_result.success=true 算完成。拒绝绕过权限、状态机、消歧或确认；未明确提供的动作视为不可执行。
7. 当前用户输入优先于历史记忆。只读案件使用案件查询页；修改、提交、撤件才进入处理页。
8. 每轮输出 thought（判断过程，最多300汉字）、actionExplanation（动作依据与预期，最多160汉字）和 reply（对用户结论），三者不重复。继续任务用 decision=continue；仅完成或无法继续时 finish。有行动计划时输出从1开始的 planStep。
9. 隐私值会被本地替换为临时别名，返回后再本地恢复。类型：CASE_NO=案件号，POLICY_NO=保单号，EVENT_NO=事件号，PII_NAME=姓名，PII_ID=证件号，PII_PHONE=手机号，PII_BANK=银行卡号，PII_EMAIL=邮箱，PII_MEDICAL=诊断病情，PII_ADDRESS=地址；形如 <CASE_NO_1>。
10. 只能原样使用当前上下文已经出现的完整别名；<CASE_NO_N>、类型名或自行生成、改写的标记都不是有效值。无法确定时用已有结果或 ask_user。
${buildContextualRules(userText, context)}

输出结构：
{"thought":"最多300字的思考过程","actionExplanation":"最多160字的行动解释","reply":"给用户的简短说明","recognized":["识别出的信息"],"planStep":1,"decision":"continue 或 finish","toolCalls":[{"tool":"工具名","args":{}}]}
`.trim();
}

function tryParseJson(content: string): LlmPayload | null {
  try {
    return JSON.parse(content) as LlmPayload;
  } catch {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (start < 0) {
        if (character === "{") {
          start = index;
          depth = 1;
          inString = false;
          escaped = false;
        }
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(content.slice(start, index + 1)) as LlmPayload;
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Keep scanning for the next complete JSON object in verbose model output.
      }
      start = -1;
    }
    return null;
  }
}

function normalizePayload(payload: LlmPayload, context?: AssistantContinuationContext) {
  if (!payload || typeof payload.reply !== "string" || !Array.isArray(payload.toolCalls)) return null;
  const toolCalls = payload.toolCalls
    .map(normalizeAssistantModelToolCall)
    .filter((call): call is AssistantModelToolCall => call !== null);
  const recognized = Array.isArray(payload.recognized)
    ? payload.recognized
      .filter((item): item is string => typeof item === "string")
      .map(stripUnresolvedPrivacyTokens)
    : [];
  return {
    reply: stripUnresolvedPrivacyTokens(payload.reply),
    thought: typeof payload.thought === "string" ? stripUnresolvedPrivacyTokens(payload.thought).slice(0, 600) : undefined,
    actionExplanation: typeof payload.actionExplanation === "string"
      ? stripUnresolvedPrivacyTokens(payload.actionExplanation).slice(0, 320)
      : undefined,
    planStep: context?.taskPlan?.length
      ? Math.min(
        context.taskPlan.length,
        Math.max(1, Number.isInteger(payload.planStep) ? Number(payload.planStep) : (context.currentPlanStep ?? 1)),
      )
      : undefined,
    recognized,
    decision: payload.decision === "continue" ? "continue" as const : "finish" as const,
    toolCalls,
  };
}

function stripUnresolvedPrivacyTokens(text: string) {
  return text.replace(/<PII_(?:NAME|ID|PHONE|BANK|EMAIL|MEDICAL|ADDRESS)_[A-Z0-9]+>/gi, "相关信息")
    .replace(/<(?:CASE_NO|POLICY_NO|EVENT_NO)_[A-Z0-9]+>/gi, "已提供的编号");
}

export async function executeAssistantBackendTool(call: AssistantBackendCall, roles: readonly string[] = []) {
  if (call.tool === "query_underwriting") {
    const result = await queryUnderwritingDb(call.args);
    const policySummaries = [...new Map(result.matches.map((match) => [match.policy.policyNo, match.policy])).values()];
    return {
      type: "underwriting_query_result",
      ...result,
      relationshipCount: result.total,
      distinctPolicyCount: policySummaries.length,
      appliedFilters: { ...call.args },
      policySummaries,
      resolvedFields: policySummaries.length === 1 ? ["policyNo"] : [],
    };
  }
  if (call.tool === "query_claim_cases") {
    const result = await queryClaimCasesDb({ ...call.args, pageSize: call.args.limit });
    return {
      type: "claim_case_query_result",
      total: call.args.limit === 1 && result.items.length === 1 ? 1 : result.total,
      totalMatches: result.total,
      appliedFilters: {
        caseNo: call.args.caseNo,
        policyNo: call.args.policyNo,
        insuredName: call.args.insuredName,
        insuredIdNo: call.args.insuredIdNo,
        status: call.args.status,
        sortBy: call.args.sortBy,
        sortOrder: call.args.sortOrder,
        limit: call.args.limit,
      },
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

type AssistantBackendExecutor = (call: AssistantBackendCall, roles?: readonly string[]) => Promise<unknown>;
let assistantBackendExecutor: AssistantBackendExecutor = executeAssistantBackendTool;

export function setAssistantBackendExecutorForTesting(executor: AssistantBackendExecutor | null) {
  assistantBackendExecutor = executor ?? executeAssistantBackendTool;
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

function navigatesAndActsInSamePlan(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  const pageActions = plan.toolCalls.filter((call) => !isAssistantBackendCall(call)
    && !isAssistantUserInputCall(call)
    && !isAssistantFinishCall(call));
  return pageActions.some((call) => call.tool === "open_page") && pageActions.length > 1;
}

function isEmptyContinuation(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  return plan.decision === "continue" && plan.toolCalls.length === 0;
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

function hasUnresolvedPrivacyToken(plan: NonNullable<ReturnType<typeof normalizePayload>>) {
  return plan.toolCalls.some((call) => /<(?:PII_(?:NAME|ID|PHONE|BANK|EMAIL|MEDICAL|ADDRESS)|CASE_NO|POLICY_NO|EVENT_NO)_[A-Z0-9]+>/i.test(JSON.stringify(call.args)));
}

function runtimeRegistryCallViolation(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context: AssistantContinuationContext | undefined,
) {
  const registries = [context?.currentPageRegistry]
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  for (const call of plan.toolCalls) {
    if (isAssistantBackendCall(call)
      || isAssistantUserInputCall(call) || isAssistantFinishCall(call)
      || call.tool === "open_page") continue;
    if (!("pageId" in call.args) || typeof call.args.pageId !== "string") continue;
    const registry = [...registries].reverse().find((item) => item.pageId === call.args.pageId);
    if (!registry || !Array.isArray(registry.regions)) {
      return { tool: call.tool, pageId: call.args.pageId, targetId: "页面注册信息未加载" };
    }
    const fields = new Set<string>();
    const actions = new Set<string>();
    const visit = (regions: unknown[]) => {
      for (const rawRegion of regions) {
        if (!rawRegion || typeof rawRegion !== "object") continue;
        const region = rawRegion as { fields?: unknown; actions?: unknown; children?: unknown };
        if (Array.isArray(region.fields)) {
          for (const field of region.fields) {
            if (field && typeof field === "object" && typeof (field as { fieldId?: unknown }).fieldId === "string") {
              fields.add((field as { fieldId: string }).fieldId);
            }
          }
        }
        if (Array.isArray(region.actions)) {
          for (const action of region.actions) {
            if (action && typeof action === "object" && typeof (action as { actionId?: unknown }).actionId === "string") {
              actions.add((action as { actionId: string }).actionId);
            }
          }
        }
        if (Array.isArray(region.children)) visit(region.children);
      }
    };
    visit(registry.regions);
    if (call.tool === "set_field") {
      if (!fields.has(call.args.fieldId)) return { tool: call.tool, pageId: call.args.pageId, targetId: call.args.fieldId };
      continue;
    }
    if ("actionId" in call.args && typeof call.args.actionId === "string" && !actions.has(call.args.actionId)) {
      return { tool: call.tool, pageId: call.args.pageId, targetId: call.args.actionId };
    }
  }
  return null;
}

function repeatsResolvedClaimLookup(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const hasResolvedCase = backendToolResults.some((result) => result && typeof result === "object"
    && (((result as { type?: unknown; total?: unknown }).type === "claim_case_query_result"
      && (result as { total?: unknown }).total === 1)
      || ((result as { type?: unknown; found?: unknown }).type === "claim_case_inspection"
        && (result as { found?: unknown }).found === true)));
  return hasResolvedCase && plan.toolCalls.some((call) => call.tool === "query_claim_cases");
}

function repeatsSuccessfulUnderwritingLookup(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const successfulFilters = backendToolResults.flatMap((result) => {
    if (!result || typeof result !== "object") return [];
    const candidate = result as { type?: unknown; total?: unknown; appliedFilters?: unknown };
    if (candidate.type !== "underwriting_query_result" || typeof candidate.total !== "number" || candidate.total <= 0
      || !candidate.appliedFilters || typeof candidate.appliedFilters !== "object") return [];
    return [candidate.appliedFilters as Record<string, unknown>];
  });
  return plan.toolCalls.some((call) => call.tool === "query_underwriting"
    && successfulFilters.some((filters) => JSON.stringify(filters) === JSON.stringify(call.args)));
}

function usesApplicantNameAsInsuredName(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context?: AssistantContinuationContext,
) {
  const applicantNames = new Set(context?.history?.flatMap((entry) => entry.toolCalls.flatMap((call) =>
    call.tool === "set_field" && call.args.fieldId === "applicantName"
      ? [call.args.value.trim().toLowerCase()]
      : [])) ?? []);
  return plan.toolCalls.some((call) => call.tool === "query_underwriting"
    && typeof call.args.insuredName === "string"
    && applicantNames.has(call.args.insuredName.trim().toLowerCase()));
}

function contradictsResolvedClaimLookup(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const hasResolvedCase = backendToolResults.some((result) => result && typeof result === "object"
    && (((result as { type?: unknown; total?: unknown }).type === "claim_case_query_result"
      && (result as { total?: unknown }).total === 1)
      || ((result as { type?: unknown; found?: unknown }).type === "claim_case_inspection"
        && (result as { found?: unknown }).found === true)));
  if (!hasResolvedCase) return false;
  const asksForLocator = plan.toolCalls.filter(isAssistantUserInputCall).some((call) =>
    call.args.requestedFields.some((field) => ["caseNo", "policyNo", "insuredName", "insuredIdNo"].includes(field)),
  );
  return asksForLocator || /(未找|没有找到|未查询到|确认.{0,8}(案件号|姓名|证件号)|提供.{0,8}(案件号|姓名|证件号))/.test(plan.reply);
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

function repliesWithRedundantClaimLocator(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  if (!/CL[A-Z0-9-]{6,}/i.test(userText)) return false;
  if (!/(请|需要|麻烦).{0,8}(提供|补充|告知).{0,8}(案件号|保单号|姓名|证件号)/.test(plan.reply.replace(/\s+/g, ""))) return false;
  const claimWasNotFound = backendToolResults.some((result) => result && typeof result === "object"
    && (result as { type?: unknown }).type === "claim_case_query_result"
    && (result as { total?: unknown }).total === 0);
  return !claimWasNotFound;
}

function asksForResolvedFields(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
  userText: string,
  context?: AssistantContinuationContext,
) {
  const resolvedFields = new Set(
    backendToolResults.flatMap((result) => {
      if (!result || typeof result !== "object") return [];
      const fields = (result as { resolvedFields?: unknown }).resolvedFields;
      const appliedFilters = (result as { appliedFilters?: unknown }).appliedFilters;
      const appliedFields = appliedFilters && typeof appliedFilters === "object"
        ? Object.entries(appliedFilters)
          .filter(([, value]) => value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0))
          .map(([field]) => field)
        : [];
      return [
        ...(Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : []),
        ...appliedFields,
      ];
    }),
  );
  if (/(继续|刚才|上次|之前|那个|该)/.test(userText) && context?.memory?.recentTurns[0]) {
    const recent = context.memory.recentTurns[0];
    const memoryText = [recent.userText, recent.assistantReply, ...recent.recognized].join(" ");
    if (/CL[A-Z0-9-]{6,}/i.test(memoryText)) resolvedFields.add("caseNo");
    if (/GI[A-Z0-9-]{6,}/i.test(memoryText)) resolvedFields.add("policyNo");
  }
  return plan.toolCalls
    .filter(isAssistantUserInputCall)
    .some((call) => call.args.requestedFields.some((field) => resolvedFields.has(field)));
}

function asksForLocatorDespiteSufficientStatus(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
) {
  const hasStatusScope = /(受理中|录入中|理算中|审核中|已结案|结案|已撤件|撤件|registered|entering|calculating|reviewing|completed|cancelled)/i.test(userText);
  const asksForSet = /(最近|最新|全部|所有|任意|一笔|案件数量|most recent|latest|all|any)/i.test(userText);
  if (!hasStatusScope || !asksForSet) return false;
  return plan.toolCalls.filter(isAssistantUserInputCall).some((call) =>
    call.args.requestedFields.some((field) => ["caseNo", "policyNo", "insuredName", "insuredIdNo"].includes(field)),
  );
}

function hasOutstandingStatusScopedClaimLookup(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  backendToolResults: unknown[],
) {
  const normalized = userText.replace(/\s+/g, "");
  const hasStatusScope = /(受理中|录入中|理算中|审核中|已结案|结案|已撤件|撤件|registered|entering|calculating|reviewing|completed|cancelled)/i.test(normalized);
  const asksToRetrieveCases = /(找到|查找|查询|列出|打开|查看|定位|find|query|list|open|show|locate)/i.test(normalized);
  const asksForSet = /(最近|最新|全部|所有|任意|一笔|mostrecent|latest|all|any)/i.test(normalized);
  if (!hasStatusScope || !asksToRetrieveCases || !asksForSet) return false;

  const queriesNow = plan.toolCalls.some((call) => call.tool === "query_claim_cases");
  if (queriesNow) return false;
  // Allow another explicitly requested backend step (for example queue summary)
  // to run first; the next model turn will still be checked for the pending lookup.
  if (plan.toolCalls.some(isAssistantBackendCall)) return false;
  const alreadyQueried = backendToolResults.some((result) => {
    if (!result || typeof result !== "object") return false;
    const record = result as { type?: unknown; appliedFilters?: unknown };
    if (record.type !== "claim_case_query_result" || !record.appliedFilters || typeof record.appliedFilters !== "object") return false;
    const status = (record.appliedFilters as { status?: unknown }).status;
    return Array.isArray(status) && status.length > 0;
  });
  return !alreadyQueried;
}

function isMutationIntent(intent?: AssistantTaskIntent) {
  return intent?.mode === "write" || intent?.mode === "mixed";
}

type InspectedWorkflowAction = {
  action?: unknown;
  label?: unknown;
  toStatus?: unknown;
  toStatusLabel?: unknown;
  allowedForCurrentUser?: unknown;
};

const WORKFLOW_ACTION_LABELS: Record<string, string> = {
  cancel: "撤件",
  submit: "提交受理",
  calculate: "理算",
  submit_review: "提交审核",
  complete: "审核结案",
  rollback: "流程回退",
};

function workflowIntentAliases(action: string) {
  const aliases: Record<string, string[]> = {
    cancel: ["撤件", "撤销案件", "withdraw", "withdrawal", "cancel case"],
    submit: ["提交", "submit"],
    calculate: ["理算", "calculate", "calculation"],
    submit_review: ["提交审核", "submit review"],
    complete: ["结案", "complete", "close case"],
    rollback: ["回退", "退回", "rollback", "return case"],
  };
  return [action, ...(aliases[action] ?? [])];
}

function requestedWorkflowIntents(userText: string) {
  const normalized = userText.toLowerCase().replace(/\s+/g, " ");
  const intents = new Set<string>();
  if (/(撤件|撤销案件|withdrawal|withdraw|cancel case)/i.test(normalized)) intents.add("cancel");
  if (/(提交审核|submit (?:the )?(?:case|claim)? ?for review|resubmit[^.!?。！？]{0,120}(?:for )?review)/i.test(normalized)) intents.add("submit_review");
  if (/(审核结案|结案|complete review|close (?:the )?(?:case|claim|it))/i.test(normalized)) intents.add("complete");
  if (/(开始理算|执行理算|run calculation|calculate case)/i.test(normalized)) intents.add("calculate");
  if (/(回退|退回|rollback|return case)/i.test(normalized)) intents.add("rollback");
  if (/(提交受理|提交案件|submit case)/i.test(normalized)) intents.add("submit");
  return [...intents];
}

function buildUnavailableWorkflowGate(userText: string, backendToolResults: unknown[], planStep?: number, intent?: AssistantTaskIntent) {
  if (!isMutationIntent(intent)) return null;
  const requestedActions = requestedWorkflowIntents(userText);
  if (!requestedActions.length) return null;
  const inspection = [...backendToolResults].reverse().find((result) => result && typeof result === "object"
    && (result as { type?: unknown }).type === "claim_case_inspection"
    && (result as { found?: unknown }).found === true) as {
      caseNo?: unknown;
      statusLabel?: unknown;
      businessNextActions?: unknown;
      workflowActions?: unknown;
      editableAreas?: unknown;
    } | undefined;
  if (!inspection) return null;

  const businessActions = Array.isArray(inspection.businessNextActions)
    ? inspection.businessNextActions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const executableActions = Array.isArray(inspection.workflowActions)
    ? inspection.workflowActions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const knownActions = [...businessActions, ...executableActions];
  const allowedActions = new Set(knownActions
    .filter((item) => item.allowedForCurrentUser === true && typeof item.action === "string")
    .map((item) => String(item.action)));
  const businessActionNames = new Set(knownActions
    .filter((item) => typeof item.action === "string")
    .map((item) => String(item.action)));
  const unsupported = requestedActions.filter((action) => !businessActionNames.has(action));
  const unauthorized = requestedActions.filter((action) => businessActionNames.has(action) && !allowedActions.has(action));
  if (!unsupported.length && !unauthorized.length) return null;

  const caseNo = typeof inspection.caseNo === "string" ? inspection.caseNo : "当前案件";
  const statusLabel = typeof inspection.statusLabel === "string" ? inspection.statusLabel : "当前状态";
  const unsupportedLabels = unsupported.map((action) => WORKFLOW_ACTION_LABELS[action] ?? action);
  const unauthorizedLabels = unauthorized.map((action) => WORKFLOW_ACTION_LABELS[action] ?? action);
  const reasons = [
    unsupportedLabels.length ? `当前业务状态不允许执行“${unsupportedLabels.join("、")}”` : "",
    unauthorizedLabels.length ? `当前账号无权执行“${unauthorizedLabels.join("、")}”` : "",
  ].filter(Boolean);
  const reply = `案件 ${caseNo} 当前为“${statusLabel}”，${reasons.join("；")}。系统不会绕过状态机或权限限制，也不会打开其他处理页面规避校验；未执行任何数据变更。`;
  return {
    thought: "案件检查结果与请求动作不匹配，必须在执行前终止",
    actionExplanation: "依据案件状态机和当前账号权限直接拒绝非法流转，避免通过页面切换绕过后端校验。",
    reply,
    planStep,
    recognized: [`案件号：${caseNo}`, `当前状态：${statusLabel}`, ...reasons],
    decision: "finish" as const,
    toolCalls: [] as AssistantToolCall[],
  };
}

function requestedWorkflowAction(userText: string, backendToolResults: unknown[]) {
  const inspection = [...backendToolResults].reverse().find((result) => result && typeof result === "object"
    && (result as { type?: unknown }).type === "claim_case_inspection"
    && (result as { found?: unknown }).found === true) as {
      caseNo?: unknown;
      statusLabel?: unknown;
      workflowActions?: unknown;
    } | undefined;
  if (!inspection || !Array.isArray(inspection.workflowActions)) return null;
  const normalizedText = userText.toLowerCase().replace(/\s+/g, " ");
  const matches = inspection.workflowActions.filter((rawAction) => {
    if (!rawAction || typeof rawAction !== "object") return false;
    const action = rawAction as InspectedWorkflowAction;
    if (action.allowedForCurrentUser !== true || typeof action.action !== "string") return false;
    const label = typeof action.label === "string" ? action.label : "";
    const labelTokens = [label, label.replace(/案件|完成/g, "")].filter((item) => item.length >= 2);
    return [...labelTokens, ...workflowIntentAliases(action.action)]
      .some((alias) => normalizedText.includes(alias.toLowerCase()));
  }) as InspectedWorkflowAction[];
  return matches.length === 1 ? { inspection, action: matches[0]! } : null;
}

function explicitlyRequestsConfirmation(userText: string) {
  return /(向我确认|等我确认|确认后|获得.{0,6}确认|wait for my confirmation|ask (?:me )?to confirm|confirm before)/i.test(userText);
}

function hasFollowupConfirmation(userText: string) {
  const supplement = userText.match(/用户补充信息：([\s\S]*)$/)?.[1]?.trim() ?? "";
  return /^(?:我)?(?:明确)?(?:确认|同意|继续执行)|^(?:yes|confirm|confirmed|proceed)\b/i.test(supplement);
}

function buildWorkflowConfirmationGate(userText: string, backendToolResults: unknown[], planStep?: number) {
  if (!explicitlyRequestsConfirmation(userText) || hasFollowupConfirmation(userText)) return null;
  const matched = requestedWorkflowAction(userText, backendToolResults);
  if (!matched) return null;
  const caseNo = typeof matched.inspection.caseNo === "string" ? matched.inspection.caseNo : "当前案件";
  const statusLabel = typeof matched.inspection.statusLabel === "string" ? matched.inspection.statusLabel : "当前状态";
  const actionLabel = typeof matched.action.label === "string" ? matched.action.label : "状态变更";
  const toStatusLabel = typeof matched.action.toStatusLabel === "string" ? matched.action.toStatusLabel : "目标状态";
  const question = `案件 ${caseNo} 当前为“${statusLabel}”，当前账号允许执行“${actionLabel}”。执行后状态将变为“${toStatusLabel}”，当前处理流程会按新状态继续或终止，系统会保留本次流转记录。请明确回复“确认${actionLabel}”后执行。`;
  return {
    thought: "状态与权限已核对，等待用户明确确认",
    reply: question,
    planStep,
    recognized: [`案件号：${caseNo}`, `当前状态：${statusLabel}`, `可执行操作：${actionLabel}`],
    decision: "continue" as const,
    toolCalls: [] as AssistantToolCall[],
    userInputRequest: { question, requestedFields: ["operationConfirmation"] },
  };
}

function prematurelyStopsBeforeLookup(
  userText: string,
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context?: AssistantContinuationContext,
  backendToolResults: unknown[] = [],
) {
  if (!isMutationIntent(context?.taskIntent)) return false;
  if (backendToolResults.some((result) => result && typeof result === "object"
    && ["claim_case_query_result", "underwriting_query_result"].includes(String((result as { type?: unknown }).type))
    && (result as { total?: unknown }).total === 0)) return false;
  if (plan.toolCalls.some(isAssistantUserInputCall)) return false;
  const lastResult = getLatestOperationResult(context?.lastOperationResult) as { type?: unknown; success?: unknown; operation?: unknown; reason?: unknown } | undefined;
  if (lastResult?.type === "mutation_result" && lastResult.success === true && lastResult.operation !== "create_event") return false;
  if (lastResult?.type === "operation_error" && typeof lastResult.reason === "string" && /(ambiguous|not_found)/.test(lastResult.reason)) return false;
  const hasExecutableAction = plan.toolCalls.some((call) => !isAssistantFinishCall(call));
  const hasCompletionAction = plan.toolCalls.some((call) => {
    if (isAssistantFinishCall(call)) return false;
    if (call.tool !== "click_button") return false;
    return /^(save_|submit_|cancel_|delete_|remove_)/.test(call.args.actionId) && call.args.actionId !== "create_event";
  });
  if (!hasExecutableAction) return true;
  return plan.decision === "finish" && !hasCompletionAction;
}

function getLatestOperationResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const candidate = result as { type?: unknown; results?: unknown };
  if (candidate.type !== "operation_batch" || !Array.isArray(candidate.results) || candidate.results.length === 0) return result;
  const latest = candidate.results[candidate.results.length - 1];
  return latest && typeof latest === "object" && "result" in latest
    ? (latest as { result?: unknown }).result
    : latest;
}

function completedNavigationOnlyTask(userText: string, context?: AssistantContinuationContext) {
  const latest = getLatestOperationResult(context?.lastOperationResult) as { type?: unknown; success?: unknown; pageId?: unknown } | undefined;
  if (latest?.type !== "page_opened" || latest.success !== true || typeof latest.pageId !== "string") return null;
  const normalized = userText.replace(/\s+/g, "");
  if (!/^(?:请)?(?:帮我)?(?:打开|进入|跳转到?|切换到?).{1,30}(?:页面|页)[。！!？?]*$/.test(normalized)) return null;
  return { pageId: latest.pageId, label: getCompactPageRegistration(latest.pageId)?.label ?? latest.pageId };
}

function repeatedFailedPageAction(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context?: AssistantContinuationContext,
) {
  const lastResult = getLatestOperationResult(context?.lastOperationResult);
  if (!lastResult || typeof lastResult !== "object") return null;
  const failure = lastResult as { type?: unknown; reason?: unknown; pageId?: unknown; actionId?: unknown };
  if (failure.type !== "operation_error" || typeof failure.actionId !== "string") return null;
  const repeated = plan.toolCalls.some((call) => call.tool === "click_button"
    && call.args.pageId === failure.pageId
    && call.args.actionId === failure.actionId);
  if (!repeated) return null;

  let prerequisiteAction: string | undefined;
  if (failure.reason === "confirmation_required" && failure.actionId.startsWith("confirm_")) {
    const candidate = `request_${failure.actionId.slice("confirm_".length)}`;
    const registryText = JSON.stringify(context?.currentPageRegistry ?? {});
    if (registryText.includes(`\"actionId\":\"${candidate}\"`)) prerequisiteAction = candidate;
  }
  return {
    reason: typeof failure.reason === "string" ? failure.reason : "operation_failed",
    failedAction: failure.actionId,
    prerequisiteAction,
  };
}

function violatesOperationRecovery(
  plan: NonNullable<ReturnType<typeof normalizePayload>>,
  context?: AssistantContinuationContext,
) {
  const lastResult = getLatestOperationResult(context?.lastOperationResult);
  if (!lastResult || typeof lastResult !== "object") return null;
  const failure = lastResult as {
    type?: unknown;
    reason?: unknown;
    recovery?: { tool?: unknown; pageId?: unknown; actionId?: unknown; itemIdSource?: unknown };
  };
  const recovery = failure.recovery;
  if (failure.type !== "operation_error" || !recovery || typeof recovery.tool !== "string") return null;
  const followsRecovery = plan.toolCalls.some((call) => {
    if (call.tool !== recovery.tool) return false;
    if (recovery.pageId && "pageId" in call.args && call.args.pageId !== recovery.pageId) return false;
    if (recovery.actionId && "actionId" in call.args && call.args.actionId !== recovery.actionId) return false;
    return true;
  });
  if (followsRecovery || plan.toolCalls.some(isAssistantUserInputCall)) return null;
  return {
    reason: typeof failure.reason === "string" ? failure.reason : "operation_failed",
    recovery,
  };
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
  const latestResult = getLatestOperationResult(result);
  if (!latestResult || typeof latestResult !== "object") return null;
  const candidate = latestResult as { type?: unknown; reason?: unknown };
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
  if (/标准公式/.test(text)) return "standard_formula_management";
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

const fallbackTaskPlan = [
  "确认任务目标、已知信息和当前权限",
  "在系统中定位相关业务对象",
  "按业务规则执行操作并核对结果",
];

function containsUnsupportedPlanningDetails(steps: string[], userText: string) {
  const speculativeDetail = /(通常|一般|例如|比如|手续费|到账时间|不可恢复|将被.{0,8}(保留|作废|退回)|状态为.{0,12}(允许|可以|可办理))/;
  return speculativeDetail.test(steps.join(" ")) && !speculativeDetail.test(userText);
}

/**
 * Creates the task-level plan before the execution agent is allowed to choose
 * tools. This is deliberately separate from requestAgentPlan: the latter is a
 * short-horizon solver and may revise its next action after each observation.
 */
export async function requestTaskBlueprint(userText: string, provider: LlmProvider, context?: AssistantContinuationContext): Promise<AssistantTaskBlueprint> {
  const protector = new ExternalDataProtector();
  const runId = randomUUID().slice(0, 8);
  const llm = getLlmIdentity(provider);
  const messages: OllamaMessage[] = [
    {
      role: "system",
      content: `你是团体健康险理赔平台的任务规划器。系统包含保单、保障计划、险种责任、被保人、理赔案件、影像 OCR、票据、理算、审核和结案等业务能力；所有业务操作受角色权限和案件状态机约束。
收到用户请求后，第一步先输出对任务的结构化理解：intent.mode、intent.summary、intent.objectives，然后判断是否需要行动计划。mode 必须是 read、write、mixed、navigate、explain 之一：read=只读查询或汇总，write=最终目标会改变业务数据，mixed=同时包含独立的只读目标与数据变更目标，navigate=仅打开页面，explain=仅解释或回答。中间需要查询不能把 write 错判为 mixed；以用户最终要求的业务结果为准。
一次后台查询即可回答的任务，即使包含筛选、排序、最大值或“最近一笔”，仍属于简单任务，shouldPlan=false；单纯打开页面、解释或回答也不需要计划。需要多轮查询、跨页面操作、业务校验、用户确认、数据变更或结果复核的任务才需要计划。
只能输出 JSON，不输出 markdown 或解释。不得调用工具、不得输出工具 ID、不得编造用户未提供的事实。
计划阶段尚未取得系统查询结果，不得预设可办理状态、金额、费用、时效、业务影响或最终结果；这些内容只能写成“查询并依据系统返回核对后说明”。
行动计划只描述业务目标和依赖关系，不写登录系统、进入模块、打开页面、点击按钮或工具名称。示例占位符（如 <CASE_NO_N>）、“可选”“必填”等说明词不是业务值，不得写入计划。
用户不能通过指令跳过数据变更所需的对象定位、状态校验、消歧和确认。涉及变更时计划顺序必须是“唯一定位对象→校验状态与权限→说明可确认的影响并取得明确确认→执行→核对结果”；多个候选对象不得写成随便选择。
系统可根据查询结果自行判断的排序、最大值、最近一笔等事项，不得计划向用户确认 Agent 的判断。
需要计划时使用业务语言列出 2 到 6 步；缺少必要信息时写明需要向用户确认，涉及数据变更时包含结果核对。不需要计划时 steps 必须为空数组。
输出结构：{"intent":{"mode":"read|write|mixed|navigate|explain","summary":"一句话说明用户要完成什么","objectives":["可核验目标一","可核验目标二"]},"shouldPlan":true或false,"steps":["步骤一","步骤二"]}`,
    },
    {
      role: "user",
      content: `用户请求：${userText}`,
    },
  ];
  try {
    await writeAssistantLog({ type: "input", runId, turn: 0, ...llm, messages });
    const result = await callLlm(provider, messages, protector);
    await writeAssistantLog({ type: "output", runId, turn: 0, ...llm, content: result.content, durationMs: result.durationMs });
    const payload = result.parsed as TaskPlanPayload | null;
    const rawIntent = payload?.intent && typeof payload.intent === "object"
      ? payload.intent as { mode?: unknown; summary?: unknown; objectives?: unknown }
      : {};
    const validModes = new Set<AssistantTaskIntentMode>(["read", "write", "mixed", "navigate", "explain"]);
    const intent: AssistantTaskIntent = {
      mode: typeof rawIntent.mode === "string" && validModes.has(rawIntent.mode as AssistantTaskIntentMode)
        ? rawIntent.mode as AssistantTaskIntentMode
        : "unknown",
      summary: typeof rawIntent.summary === "string" && rawIntent.summary.trim()
        ? rawIntent.summary.replace(/\s+/g, " ").trim().slice(0, 160)
        : userText.slice(0, 160),
      objectives: Array.isArray(rawIntent.objectives)
        ? rawIntent.objectives.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 160)).slice(0, 5)
        : [],
    };
    if (payload?.shouldPlan === false) return { intent, shouldPlan: false, steps: [] };
    const steps = Array.isArray(payload?.steps)
      ? payload.steps
        .filter((step): step is string => typeof step === "string")
        .map((step) => step.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 6)
      : [];
    const taskSteps = payload?.shouldPlan === true && steps.length >= 2 && !containsUnsupportedPlanningDetails(steps, userText)
      ? steps
      : fallbackTaskPlan;
    return { intent, shouldPlan: true, steps: taskSteps };
  } catch {
    // Planning must not prevent a valid user request from being processed when
    // the model returns malformed planning JSON; the solver still validates all actions.
    return {
      intent: { mode: "unknown", summary: userText.slice(0, 160), objectives: [] },
      shouldPlan: true,
      steps: fallbackTaskPlan,
    };
  }
}

export async function requestTaskPlan(userText: string, provider: LlmProvider, context?: AssistantContinuationContext) {
  return (await requestTaskBlueprint(userText, provider, context)).steps;
}

export async function requestAgentPlan(
  userText: string,
  provider: LlmProvider,
  context?: AssistantContinuationContext,
): Promise<{ ok: true; rawReplies: string[]; plan: AssistantPlan } | { ok: false; reason: "invalid_plan"; rawReplies: string[] }> {
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
  const existingUnavailableWorkflow = buildUnavailableWorkflowGate(
    userText,
    context?.backendToolResults ?? [],
    context?.currentPlanStep,
    context?.taskIntent,
  );
  if (existingUnavailableWorkflow) {
    return {
      ok: true as const,
      rawReplies: [],
      plan: {
        ...existingUnavailableWorkflow,
        discoverySteps: [],
        discoveryResults: [],
        backendToolResults: context?.backendToolResults ?? [],
      },
    };
  }
  const completedNavigation = completedNavigationOnlyTask(userText, context);
  if (completedNavigation) {
    return {
      ok: true as const,
      rawReplies: [],
      plan: {
        thought: "目标页面已打开，任务完成",
        reply: `已打开${completedNavigation.label}。`,
        planStep: context?.taskPlan?.length ? context.taskPlan.length : undefined,
        recognized: [`目标页面：${completedNavigation.label}`],
        decision: "finish" as const,
        toolCalls: [] as AssistantToolCall[],
        discoverySteps: [],
        discoveryResults: [],
        backendToolResults: context?.backendToolResults ?? [],
      },
    };
  }
  const existingConfirmationGate = buildWorkflowConfirmationGate(
    userText,
    context?.backendToolResults ?? [],
    context?.currentPlanStep,
  );
  if (existingConfirmationGate) {
    return {
      ok: true as const,
      rawReplies: [],
      plan: {
        ...existingConfirmationGate,
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
    memory: context.memory ? { recentTurns: context.memory.recentTurns.slice(-8) } : undefined,
    history: context.history?.slice(-8),
    currentPageRegistry: context.currentPageRegistry,
    lastOperationResult: context.lastOperationResult,
    backendToolResults: context.backendToolResults,
    actorRoles: context.actorRoles,
    taskPlan: context.taskPlan,
    taskIntent: context.taskIntent,
    currentPlanStep: context.currentPlanStep,
  }) as AssistantContinuationContext : undefined;
  const userMessage = context
    ? `${userText}

当前 Agent 状态如下，请只根据以下信息决定下一步：

当前用户的跨任务历史记忆（仅作连续性参考，当前明确输入优先）：
${JSON.stringify(minimizedContext?.memory?.recentTurns ?? [])}

历史操作记录：
${JSON.stringify(minimizedContext?.history ?? [])}

当前页面注册信息：
${JSON.stringify(minimizedContext?.currentPageRegistry ?? null)}

上一次操作结果：
${formatLastOperationResult(minimizedContext?.lastOperationResult)}

本任务已取得的后台工具结果：
${JSON.stringify(minimizedContext?.backendToolResults ?? [])}

本任务行动计划：
${JSON.stringify(minimizedContext?.taskPlan ?? [])}

本任务意图：
${JSON.stringify(minimizedContext?.taskIntent ?? null)}

当前计划步骤：
${minimizedContext?.currentPlanStep ?? "未开始"}`
    : userText;
  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt(userText, context) },
    { role: "user", content: userMessage },
  ];
  const discoverySteps: string[] = [];
  const backendToolResults: unknown[] = [...(context?.backendToolResults ?? [])];
  const rawReplies: string[] = [];
  let lastPlan: ReturnType<typeof normalizePayload> = null;
  const planSignatureCounts = new Map<string, number>();

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
    const plan = normalizePayload(result.parsed, context);
    if (!plan) return { ok: false as const, reason: "invalid_plan" as const, rawReplies };
    const planSignature = JSON.stringify({ decision: plan.decision, toolCalls: plan.toolCalls });
    const planSignatureCount = (planSignatureCounts.get(planSignature) ?? 0) + 1;
    planSignatureCounts.set(planSignature, planSignatureCount);
    if (planSignatureCount > 2) break;
    const rawToolCallCount = Array.isArray(result.parsed.toolCalls) ? result.parsed.toolCalls.length : 0;
    if (rawToolCallCount > plan.toolCalls.length) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：计划中包含参数缺失、未注册或不可执行的工具调用。‘可选、必填、string、目标字段’等目录说明词不是业务参数值；请使用用户输入或已有结果中的真实值，未提供的可选字段必须省略。后台查询工具至少需要一个明确条件；查询全部数据时应使用目标页面的 reset 和 search。请根据工具定义修正，并只输出新的 JSON 计划。",
      });
      continue;
    }
    lastPlan = plan;

    if (hasOutstandingStatusScopedClaimLookup(userText, plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：用户要求检索某一案件状态下的案件集合，但本任务尚未执行带 status 条件的 query_claim_cases。汇总数量只完成了统计步骤，不能代替案件检索，也不能提前 finish 或 ask_user。请继续执行状态查询；如果要求最近更新一笔，使用 sortBy=updatedAt、sortOrder=desc、limit=1。只输出新的 JSON 计划。",
      });
      continue;
    }

    if (isEmptyContinuation(plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：你声明还要继续，但没有返回任何工具调用或 ask_user。不得只回复“正在查询/处理中”。请立即返回一个明确的下一步工具调用；若缺少用户才能提供的信息，使用 ask_user。",
      });
      continue;
    }

    if (hasUnresolvedPrivacyToken(plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：工具参数包含未还原的隐私占位符。该占位符不能作为查询条件；请使用本任务已取得的案件结果继续，或在确实无法定位时 ask_user。",
      });
      continue;
    }

    const unavailableRuntimeCall = runtimeRegistryCallViolation(plan, context);
    if (unavailableRuntimeCall) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: `系统校验发现：工具 ${unavailableRuntimeCall.tool} 的目标 ${unavailableRuntimeCall.targetId} 不在页面 ${unavailableRuntimeCall.pageId} 当前运行状态允许的字段或动作中，禁止下发执行。只能从当前经过运行时裁剪的页面注册信息选择工具；若需要切换页面，本轮只调用 open_page，等待新页面能力返回。只输出新的 JSON 计划。`,
      });
      continue;
    }

    const repeatedFailure = repeatedFailedPageAction(plan, context);
    if (repeatedFailure) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: `系统校验发现：上一轮页面动作 ${repeatedFailure.failedAction} 已返回 ${repeatedFailure.reason}，禁止使用相同参数重复调用失败动作。${repeatedFailure.prerequisiteAction ? `当前页面已注册前置动作 ${repeatedFailure.prerequisiteAction}，请先执行该动作，取得结果后再决定是否调用确认动作。` : "请依据错误结果和页面注册信息选择不同的恢复动作；缺少用户信息时使用 ask_user。"}只输出新的 JSON 计划。`,
      });
      continue;
    }

    const requiredRecovery = violatesOperationRecovery(plan, context);
    if (requiredRecovery) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: `系统校验发现：上一轮页面操作返回 ${requiredRecovery.reason}，并提供了结构化恢复指令 ${JSON.stringify(requiredRecovery.recovery)}。在恢复成功前不得继续原业务动作。请使用后台结果中已经唯一确定的 itemId 补全恢复工具参数并执行；只有确实缺少该值时才 ask_user。只输出新的 JSON 计划。`,
      });
      continue;
    }

    if (repeatsResolvedClaimLookup(plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：案件已唯一定位，禁止重复 query_claim_cases。若尚未检查状态，请调用 inspect_claim_case；已检查且需要用户决定时使用 ask_user，不得用新的姓名或占位符再次查询。",
      });
      continue;
    }

    if (repeatsSuccessfulUnderwritingLookup(plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：相同参数的承保查询已经成功返回结果，禁止重复调用。请直接使用已有 policySummaries 或页面查询结果完成比较和回答；只有用户明确要求打开详情且尚未打开时才执行对应页面动作。",
      });
      continue;
    }

    if (usesApplicantNameAsInsuredName(plan, context)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前值来自保单查询页的投保单位字段，不能作为自然人被保人姓名传给 query_underwriting。请使用现有页面查询结果继续比较和回答，不要改变字段语义。",
      });
      continue;
    }

    if (contradictsResolvedClaimLookup(plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：案件已经由后台唯一定位或检查成功，禁止回复“未找到”，也不得再次索要案件号、姓名或证件号。请依据已取得的案件状态、权限和流程结果继续：可执行且需确认时 ask_user；无权限或状态不允许时说明实际原因。",
      });
      continue;
    }

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
          backendToolResults,
        },
      };
    }

    if (asksForResolvedFields(plan, backendToolResults, userText, context)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前 ask_user 请求的字段已经由用户提供并用于后台查询，禁止因为 total=0 再次询问相同姓名、案件号、保单号或证件号。请准确保留 appliedFilters 的查询范围，直接说明没有符合这些条件的结果并结束；仅追问后台结果、当前输入和最近明确指代中都不存在、且完成任务必需的信息。",
      });
      continue;
    }

    if (asksForLocatorDespiteSufficientStatus(userText, plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：用户已经给出明确案件状态，并要求该状态下的全部、任意、最近或最新案件。status 本身就是 query_claim_cases 的有效条件，不需要案件号、保单号、姓名或证件号。请直接按状态查询；最近更新一笔使用 sortBy=updatedAt、sortOrder=desc、limit=1。不得 ask_user。只输出新的 JSON 计划。",
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

    if (asksForRedundantClaimLocator(userText, plan, backendToolResults)
      || repliesWithRedundantClaimLocator(userText, plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：用户已经提供案件号，案件号就是充分定位条件，不能再询问保单号、姓名或证件号。只读查询请直接在案件查询页按案件号检索并查看详情；维护任务则使用 query_claim_cases 定位后打开受理立案并继续。",
      });
      continue;
    }

    if (prematurelyStopsBeforeLookup(userText, plan, context, backendToolResults)) {
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


    if (navigatesAndActsInSamePlan(plan)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前计划在打开页面的同一轮又执行了其他页面动作。页面切换会重置运行状态，且新页面的实时可用字段和动作尚未返回；本轮只能执行 open_page。打开完成后，系统会提供经过运行时裁剪的新页面注册信息，再选择下一步。只输出新的 JSON 计划。",
      });
      continue;
    }

    const backendCalls = plan.toolCalls.filter(isAssistantBackendCall);
    const userInputCalls = plan.toolCalls.filter(isAssistantUserInputCall);
    const finishCalls = plan.toolCalls.filter(isAssistantFinishCall);
    const actionCalls = plan.toolCalls.filter((call): call is AssistantToolCall => !isAssistantBackendCall(call) && !isAssistantUserInputCall(call) && !isAssistantFinishCall(call));
    if (backendCalls.length === 0) {
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
          backendToolResults,
        },
      };
    }

    const backendResults = await Promise.all(backendCalls.map(async (call) => {
      try {
        return await assistantBackendExecutor(call, context?.actorRoles);
      } catch {
        return {
          type: "backend_tool_error",
          tool: call.tool,
          reason: "execution_failed",
        };
      }
    }));
    backendToolResults.push(...backendResults);
    backendCalls.forEach((call) => discoverySteps.push(formatToolInvocation(call.tool, call.args)));

    const unavailableWorkflow = buildUnavailableWorkflowGate(userText, backendToolResults, plan.planStep, context?.taskIntent);
    if (unavailableWorkflow) {
      return {
        ok: true as const,
        rawReplies,
        plan: {
          ...unavailableWorkflow,
          discoverySteps,
          backendToolResults,
        },
      };
    }

    const confirmationGate = buildWorkflowConfirmationGate(userText, backendToolResults, plan.planStep);
    if (confirmationGate) {
      return {
        ok: true as const,
        rawReplies,
        plan: {
          ...confirmationGate,
          discoverySteps,
          backendToolResults,
        },
      };
    }

    messages.push({ role: "assistant", content: result.content });
    messages.push({
      role: "user",
      content: `工具执行结果如下：${JSON.stringify(minimizeAssistantData(backendResults))}。请根据这些结果继续下一步，只输出新的 JSON 计划。`,
    });
  }

  return {
    ok: true as const,
    rawReplies,
    plan: {
      reply: "当前任务尚未完成，系统没有取得可继续执行的下一步操作。任务已暂停，不能将中间状态视为完成。",
      recognized: ["任务未完成，已安全暂停"],
      decision: "continue" as const,
      toolCalls: [] as AssistantToolCall[],
      userInputRequest: {
        question: "当前任务尚未完成，系统没有取得可继续执行的下一步操作。请确认是否继续重试，或补充更明确的业务要求。",
        requestedFields: ["taskContinuation"],
      },
      discoverySteps,
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
