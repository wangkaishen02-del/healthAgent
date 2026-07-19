import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
} from "../../../../src/assistant/policy-query-assistant";
import {
  getAssistantActionToolCatalog,
  getAssistantBackendToolCatalog,
  getAssistantControlToolCatalog,
  getAssistantDiscoveryToolCatalog,
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
} from "../../../../src/assistant/page-registry";
import { queryUnderwriting } from "../../../../src/underwriting/service";

type LlmProvider = "ollama" | "deepseek";

const DEFAULT_LLM_PROVIDER: LlmProvider = process.env.LLM_PROVIDER === "deepseek" ? "deepseek" : "ollama";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const DEEPSEEK_URL = process.env.DEEPSEEK_URL ?? "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90000);
const MAX_AGENT_TURNS = 5;
const ASSISTANT_LOG_DIR = join(process.cwd(), "logs");
const ASSISTANT_LOG_PATH = join(ASSISTANT_LOG_DIR, "assistant-llm.log");

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

type AssistantContinuationContext = {
  currentPagePath?: string[];
  currentPageRegistry?: unknown;
  history?: Array<{
    toolCalls: AssistantToolCall[];
  }>;
  lastOperationResult?: unknown;
  backendToolResults?: unknown[];
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
    const messages = entry.messages.map((message, index) => [
      `[${index + 1}] ${message.role.toUpperCase()}`,
      message.content,
    ].join("\n"));
    return [...header, ...messages, "=".repeat(84)].join("\n");
  }

  return [
    ...header,
    `duration=${entry.durationMs}ms`,
    formatJsonIfPossible(entry.content),
    "=".repeat(84),
  ].join("\n");
}

async function writeAssistantLog(entry: AssistantLogEntry) {
  const content = formatAssistantLog(entry);
  console.info(content);
  try {
    await mkdir(ASSISTANT_LOG_DIR, { recursive: true });
    await appendFile(ASSISTANT_LOG_PATH, `${content}\n`, "utf8");
  } catch {
    // 日志写入失败不额外输出，保持控制台与日志文件内容一致。
  }
}

function buildSystemPrompt() {
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `
你是健康险承保查询系统里的页面操作 Agent。你必须先通过注册信息理解系统能力，再选择页面动作。
你只能输出 JSON，不要输出 markdown、解释或代码块。
当前系统日期（Asia/Shanghai）：${currentDate}。

当前系统导航信息（已直接提供，无需调用工具）：
${JSON.stringify(getNavigationRegistry())}

注册信息发现工具：
${JSON.stringify(getAssistantDiscoveryToolCatalog())}

页面操作工具：
${JSON.stringify(getAssistantActionToolCatalog())}

后台数据工具：
${JSON.stringify(getAssistantBackendToolCatalog())}

任务控制工具：
${JSON.stringify(getAssistantControlToolCatalog())}

工作规则：
1. 根据当前上下文判断是否需要查询注册信息。如果已有足够可信的菜单、页面、字段和动作信息，可以直接执行；如果缺少信息或不确定，应先调用相应的注册信息查询工具。
2. 不要猜测注册ID。菜单、页面、字段、按钮和结果操作的参数都必须填写注册中心返回的ID，不要把面向用户的中文名称当作ID。
3. 注册信息查询和页面动作可以按任务需要分多轮进行，每一轮根据上一步结果决定继续发现、执行动作还是结束。
4. 如果上下文中已经提供历史操作记录和上一次操作结果，应优先使用这些信息，不要恢复或猜测更早的查询结果。
5. 原始用户请求中如果包含明确的筛选值，执行查询动作前必须使用注册字段生成对应的 set_field；不能只在 recognized 中描述而省略字段动作。
6. 字段选择必须依据注册字段的标签、描述和所在区域，不要根据字段ID命名习惯猜测用途。
7. select 字段必须使用当前页面注册信息声明的 options 值；运行时选项会随页面上下文提供，不要自行创造选项值。
8. 如果已经可以执行页面动作，返回 open_page、set_field、click_button、click_list_row_action；如果任务已经完成或无法继续，返回 finish_task。
9. 一次页面计划最多选择一个结果行操作，因为当前页面一次只能展示一个结果详情区域；需要处理其他结果时，等待执行结果后再继续。
10. decision=continue 表示 Agent 还需要下一轮，decision=finish 表示结束本次任务。
11. 每轮必须输出 thought，简短说明当前判断和下一步计划；不要输出冗长逐字推理。
12. 对新增、修改、删除等数据变更请求，打开页面、选中对象、打开编辑器或填写字段都只是中间步骤；只有上一次操作结果明确返回成功的 mutation_result 后，才可以 finish_task。否则必须 decision=continue 并继续完成保存或确认动作。
13. 用户只提供姓名、名称等可查询条件时，不要立即要求用户补充系统能够查询到的编号或证件信息。优先使用后台数据工具，不要为了取数操作前端查询页面；查询结果唯一时直接打开目标业务页面继续。只有结果为空或存在多个无法消歧的对象时，才使用 ask_user 请求补充定位信息。
14. 不得编造用户没有提供且系统结果中不存在的日期、地点、医院、诊断、账号等事实。页面已有默认值时保留默认值；可选字段缺失时保持为空。可以把用户原话整理为必填的简短事件描述，但不得添加原话没有表达的具体事实。
15. 当任务缺少系统无法查询且用户未提供的必填信息时，使用 ask_user 明确询问并列出 requestedFields。ask_user 会暂停任务，用户回答后继续原任务；不要用普通 reply 或 finish_task 代替追问。
16. 不要规范或限制用户的表达方式。追问时使用自然语言，不要求用户提供页面字段ID、枚举值或 YYYY-MM-DD 等技术格式；应理解用户的原始回答，并只在内部工具参数中转换为页面需要的值。引用用户描述时保留原意和措辞，不把改写后的文本冒充用户原话。

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

function executeDiscovery(call: AssistantDiscoveryCall) {
  if (call.tool === "get_navigation_registry") return getNavigationRegistry();
  if (call.tool === "get_menu_pages") return getMenuPages(call.args.menuId) ?? { error: "menu_not_found" };
  return getPageRegistration(call.args.pageId) ?? { error: "page_not_found" };
}

function executeBackendTool(call: AssistantBackendCall) {
  if (call.tool === "query_underwriting") {
    const result = queryUnderwriting(call.args);
    return {
      type: "underwriting_query_result",
      ...result,
      resolvedFields: result.total === 1 ? ["policyNo", "insuredName", "insuredIdNo"] : [],
    };
  }
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
  return plan.toolCalls.filter((call) => call.tool === "click_list_row_action").length > 1;
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

function isDataMutationRequest(userText: string) {
  return /(新增|创建|立案|配置|修改|更新|删除|撤件|提交|保存|关联|上传|办理|登记)/.test(userText);
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

function getLlmIdentity(provider: LlmProvider) {
  if (provider === "ollama") return { provider, model: OLLAMA_MODEL };
  return { provider, model: DEEPSEEK_MODEL };
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

async function callDeepSeek(messages: OllamaMessage[]) {
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
        messages,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    return { content, parsed: tryParseJson(content), durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function callLlm(provider: LlmProvider, messages: OllamaMessage[]) {
  return provider === "deepseek" ? callDeepSeek(messages) : callOllama(messages);
}

async function requestAgentPlan(userText: string, provider: LlmProvider, context?: AssistantContinuationContext) {
  const runId = randomUUID().slice(0, 8);
  const llm = getLlmIdentity(provider);
  const userMessage = context
    ? `${userText}

当前 Agent 状态如下，请只根据以下信息决定下一步：

历史操作记录：
${JSON.stringify(context.history ?? [])}

当前页面注册信息：
${JSON.stringify(context.currentPageRegistry ?? null)}

上一次操作结果：
${formatLastOperationResult(context.lastOperationResult)}

本任务已取得的后台工具结果：
${JSON.stringify(context.backendToolResults ?? [])}

当前页面路径：
${context.currentPagePath?.join(" -> ") ?? "未知"}`
    : userText;
  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: userMessage },
  ];
  const discoverySteps: string[] = [];
  const discoveredResources: unknown[] = [];
  const backendToolResults: unknown[] = [...(context?.backendToolResults ?? [])];
  const rawReplies: string[] = [];
  let lastPlan: ReturnType<typeof normalizePayload> = null;

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    await writeAssistantLog({ type: "input", runId, turn, ...llm, messages });
    const result = await callLlm(provider, messages);
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
    lastPlan = plan;

    if (asksForResolvedFields(plan, backendToolResults)) {
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: "系统校验发现：当前 ask_user 请求的字段已经由后台工具唯一确定。请直接使用后台结果填写页面，不要再次询问用户；仅追问后台结果和用户原始输入中都不存在、且完成任务必需的信息。",
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
        content: "系统校验发现：当前页面一次只能打开一个详情区域，但当前计划包含多个 click_list_row_action。请只选择一个最符合当前用户目标的列表行操作，执行后等待结果再决定是否继续；不要一次返回多个列表行操作。",
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

    const discoveryResults = discoveryCalls.map(executeDiscovery);
    const backendResults = backendCalls.map(executeBackendTool);
    backendToolResults.push(...backendResults);
    discoveredResources.push(...discoveryResults);
    discoveryCalls.forEach((call) => discoverySteps.push(formatDiscoveryStep(call)));
    backendCalls.forEach((call) => discoverySteps.push(formatToolInvocation(call.tool, call.args)));
    messages.push({ role: "assistant", content: result.content });
    messages.push({
      role: "user",
      content: `工具执行结果如下：${JSON.stringify([...discoveryResults, ...backendResults])}。请根据这些结果继续下一步，只输出新的 JSON 计划。`,
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

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    text?: string;
    provider?: unknown;
    context?: AssistantContinuationContext;
  } | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ message: "text is required" }, { status: 400 });
  const provider = body?.provider ?? DEFAULT_LLM_PROVIDER;
  if (provider !== "ollama" && provider !== "deepseek") {
    return NextResponse.json({ message: "unsupported_llm_provider" }, { status: 400 });
  }

  try {
    const result = await requestAgentPlan(text, provider, body?.context);
    if (!result.ok) {
      return NextResponse.json({ message: "llm_invalid_plan", detail: "本地模型返回了无法解析的执行计划。" }, { status: 502 });
    }
    return NextResponse.json(result.plan);
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? `模型响应超时（>${Math.round(LLM_TIMEOUT_MS / 1000)} 秒）。`
      : error instanceof Error && error.message === "deepseek_api_key_missing"
        ? "未配置 DEEPSEEK_API_KEY，无法调用 DeepSeek。"
        : error instanceof Error
          ? error.message
          : "模型当前不可用。";
    return NextResponse.json({ message: "llm_unavailable", detail }, { status: 502 });
  }
}
