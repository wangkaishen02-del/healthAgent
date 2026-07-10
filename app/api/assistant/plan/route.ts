import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isAssistantDiscoveryCall,
  isAssistantFinishCall,
  normalizeAssistantModelToolCall,
  type AssistantDiscoveryCall,
  type AssistantModelToolCall,
  type AssistantToolCall,
} from "../../../../src/assistant/policy-query-assistant";
import {
  getAssistantActionToolCatalog,
  getAssistantControlToolCatalog,
  getAssistantDiscoveryToolCatalog,
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
} from "../../../../src/assistant/page-registry";

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen3:8b";
const OLLAMA_TIMEOUT_MS = 90000;
const MAX_AGENT_TURNS = 5;
const ASSISTANT_LOG_DIR = join(process.cwd(), "logs");
const ASSISTANT_LOG_PATH = join(ASSISTANT_LOG_DIR, "assistant-llm.log");

type OllamaMessage = { role: "system" | "user" | "assistant"; content: string };
type OllamaResponse = { message?: { content?: string } };
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
};

async function writeAssistantLog(entry: Record<string, unknown>) {
  const line = JSON.stringify(entry);
  console.info("[assistant-llm]", line);
  try {
    await mkdir(ASSISTANT_LOG_DIR, { recursive: true });
    await appendFile(ASSISTANT_LOG_PATH, `${line}\n`, "utf8");
  } catch {
    // 日志写入失败不额外输出，保持日志只包含 LLM 输入和输出。
  }
}

function buildSystemPrompt() {
  return `
你是健康险承保查询系统里的页面操作 Agent。你必须先通过注册信息理解系统能力，再选择页面动作。
你只能输出 JSON，不要输出 markdown、解释或代码块。

当前系统导航信息（已直接提供，无需调用工具）：
${JSON.stringify(getNavigationRegistry())}

注册信息发现工具：
${JSON.stringify(getAssistantDiscoveryToolCatalog())}

页面操作工具：
${JSON.stringify(getAssistantActionToolCatalog())}

任务控制工具：
${JSON.stringify(getAssistantControlToolCatalog())}

工作规则：
1. 根据当前上下文判断是否需要查询注册信息。如果已有足够可信的菜单、页面、字段和动作信息，可以直接执行；如果缺少信息或不确定，应先调用相应的注册信息查询工具。
2. 不要猜测注册ID。菜单、页面、字段、按钮和结果操作的参数都必须填写注册中心返回的ID，不要把面向用户的中文名称当作ID。
3. 注册信息查询和页面动作可以按任务需要分多轮进行，每一轮根据上一步结果决定继续发现、执行动作还是结束。
4. 如果上下文中已经提供历史操作记录和上一次操作结果，应优先使用这些信息，不要恢复或猜测更早的查询结果。
5. 原始用户请求中如果包含明确的姓名、保单号、证件号、投保单位或状态等查询条件，执行 search 前必须先为这些条件生成对应的 set_field；不能只根据 recognized 描述条件而省略 set_field。
6. “张三有哪些保单”应使用注册信息中与被保人姓名对应的字段ID；公司、集团、科技、医院等通常使用投保单位对应的字段ID。
7. 保单状态的值必须使用注册字段声明的值，不要自行创造业务值。
8. 如果已经可以执行页面动作，返回 open_page、set_field、click_button、click_list_row_action；如果任务已经完成或无法继续，返回 finish_task。
9. 一次页面计划最多选择一个结果行操作，因为当前页面一次只能展示一个结果详情区域；需要处理其他结果时，等待执行结果后再继续。
10. decision=continue 表示 Agent 还需要下一轮，decision=finish 表示结束本次任务。
11. 每轮必须输出 thought，简短说明当前判断和下一步计划；不要输出冗长逐字推理。

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

function formatDiscoveryStep(call: AssistantDiscoveryCall) {
  if (call.tool === "get_menu_pages") {
    const menu = getMenuPages(call.args.menuId);
    return `查询菜单页面：${menu?.label ?? call.args.menuId}`;
  }
  if (call.tool === "get_page_registry") {
    const page = getPageRegistration(call.args.pageId);
    return `查询页面注册信息：${page?.label ?? call.args.pageId}`;
  }
  return "查询系统导航信息";
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

async function callOllama(messages: OllamaMessage[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
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
    return { content, parsed: tryParseJson(content) };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAgentPlan(userText: string, context?: AssistantContinuationContext) {
  const userMessage = context
    ? `${userText}

当前 Agent 状态如下，请只根据以下信息决定下一步：

历史操作记录：
${JSON.stringify(context.history ?? [])}

当前页面注册信息：
${JSON.stringify(context.currentPageRegistry ?? null)}

上一次操作结果：
${JSON.stringify(context.lastOperationResult ?? null)}

当前页面路径：
${context.currentPagePath?.join(" -> ") ?? "未知"}`
    : userText;
  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: userMessage },
  ];
  const discoverySteps: string[] = [];
  const discoveredResources: unknown[] = [];
  const rawReplies: string[] = [];
  let lastPlan: ReturnType<typeof normalizePayload> = null;

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    await writeAssistantLog({ llmInput: messages });
    const result = await callOllama(messages);
    rawReplies.push(result.content);
    await writeAssistantLog({ llmOutput: result.content });
    if (!result.parsed) return { ok: false as const, reason: "invalid_plan" as const, rawReplies };
    const plan = normalizePayload(result.parsed);
    if (!plan) return { ok: false as const, reason: "invalid_plan" as const, rawReplies };
    lastPlan = plan;

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
    const finishCalls = plan.toolCalls.filter(isAssistantFinishCall);
    const actionCalls = plan.toolCalls.filter((call): call is AssistantToolCall => !isAssistantDiscoveryCall(call) && !isAssistantFinishCall(call));
    if (discoveryCalls.length === 0) {
      return {
        ok: true as const,
        rawReplies,
        plan: {
          ...plan,
          toolCalls: actionCalls,
          decision: finishCalls.length > 0 ? "finish" : plan.decision,
          discoverySteps,
          discoveryResults: discoveredResources,
        },
      };
    }

    const discoveryResults = discoveryCalls.map(executeDiscovery);
    discoveredResources.push(...discoveryResults);
    discoveryCalls.forEach((call) => discoverySteps.push(formatDiscoveryStep(call)));
    messages.push({ role: "assistant", content: result.content });
    messages.push({
      role: "user",
      content: `当前页面注册信息如下：${JSON.stringify(discoveryResults)}。请根据这些注册信息继续下一步，只输出新的 JSON 计划。`,
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
    },
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { text?: string; context?: AssistantContinuationContext } | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ message: "text is required" }, { status: 400 });

  try {
    const result = await requestAgentPlan(text, body?.context);
    if (!result.ok) {
      return NextResponse.json({ message: "llm_invalid_plan", detail: "本地模型返回了无法解析的执行计划。" }, { status: 502 });
    }
    return NextResponse.json(result.plan);
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? `本地模型响应超时（>${Math.round(OLLAMA_TIMEOUT_MS / 1000)} 秒）。` : error instanceof Error ? error.message : "本地模型当前不可用。";
    return NextResponse.json({ message: "llm_unavailable", detail }, { status: 502 });
  }
}
