import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import {
  requestAgentPlan,
  requestTaskBlueprint,
  requestTaskPlan,
  type AssistantTaskBlueprint,
  type AssistantTaskIntent,
  type AssistantContinuationContext,
  type LlmProvider,
} from "../../../../src/assistant/plan-service.ts";
import { formatToolCall, type AssistantPlan } from "../../../../src/assistant/policy-query-assistant.ts";
import {
  loadAssistantMemory,
  rememberAssistantTurn,
} from "../../../../src/assistant/memory-service.ts";

type AssistantTaskStatus =
  | "running"
  | "waiting_page"
  | "waiting_user"
  | "completed"
  | "cancelled";

type PageResultResume = {
  type: "page_result";
  context: AssistantContinuationContext;
};

type UserInputResume = {
  type: "user_input";
  text: string;
};

export type AssistantTaskResume = PageResultResume | UserInputResume;

export type AssistantTaskResult = {
  taskId: string;
  status: AssistantTaskStatus;
  plan: AssistantPlan | null;
  taskPlan: string[];
  taskIntent: AssistantTaskIntent;
  context?: AssistantContinuationContext;
  question?: string;
  requestedFields?: string[];
};

type CachedAssistantTask = { result: AssistantTaskResult; touchedAt: number };

function boundedSetting(value: string | undefined, fallback: number, minimum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

const ASSISTANT_TASK_CACHE_MAX = boundedSetting(process.env.ASSISTANT_TASK_CACHE_MAX, 500, 10);
const ASSISTANT_TASK_CACHE_TTL_MS = boundedSetting(process.env.ASSISTANT_TASK_CACHE_TTL_MS, 3_600_000, 60_000);

const AssistantGraphState = Annotation.Root({
  taskText: Annotation<string>,
  provider: Annotation<LlmProvider>,
  context: Annotation<AssistantContinuationContext | undefined>,
  actorUserId: Annotation<string | undefined>,
  actorUsername: Annotation<string | undefined>,
  plan: Annotation<AssistantPlan | null>,
  taskPlan: Annotation<string[]>,
  taskIntent: Annotation<AssistantTaskIntent>,
  status: Annotation<AssistantTaskStatus>,
});

type GraphState = typeof AssistantGraphState.State;
type InterruptPayload = {
  type?: unknown;
  plan?: AssistantPlan;
  question?: unknown;
  requestedFields?: unknown;
};

function isPageResultResume(value: unknown): value is PageResultResume {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; context?: unknown };
  return candidate.type === "page_result"
    && Boolean(candidate.context)
    && typeof candidate.context === "object";
}

function isUserInputResume(value: unknown): value is UserInputResume {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; text?: unknown };
  return candidate.type === "user_input"
    && typeof candidate.text === "string"
    && candidate.text.trim().length > 0;
}

@Injectable()
export class AssistantGraphService implements OnModuleInit, OnModuleDestroy {
  private readonly postgresCheckpointer = process.env.LANGGRAPH_CHECKPOINTER !== "memory" && process.env.DATABASE_URL
    ? PostgresSaver.fromConnString(process.env.DATABASE_URL, { schema: "langgraph" })
    : null;
  private readonly checkpointer = this.postgresCheckpointer ?? new MemorySaver();
  private setupPromise: Promise<void> | null = null;
  private readonly latestResults = new Map<string, CachedAssistantTask>();
  private readonly taskOwners = new Map<string, string>();
  private planner: typeof requestAgentPlan = requestAgentPlan;
  private taskPlanner: typeof requestTaskBlueprint = requestTaskBlueprint;
  private memoryLoader: typeof loadAssistantMemory = loadAssistantMemory;
  private memoryWriter: typeof rememberAssistantTurn = rememberAssistantTurn;

  private readonly graph = new StateGraph(AssistantGraphState)
    .addNode("draft_task_plan", async (state: GraphState) => {
      const blueprint = await this.taskPlanner(state.taskText, state.provider, state.context);
      return { taskPlan: blueprint.steps, taskIntent: blueprint.intent };
    })
    .addNode("plan_agent", async (state: GraphState) => {
      const result = await this.planner(state.taskText, state.provider, {
        ...state.context,
        taskPlan: state.taskPlan,
        taskIntent: state.taskIntent,
      });
      if (!result.ok) throw new Error("llm_invalid_plan");
      return {
        plan: result.plan,
        status: "running" as const,
      };
    })
    .addNode("wait_for_page", (state: GraphState) => {
      const resumed = interrupt({
        type: "page_actions",
        plan: state.plan,
      });
      if (!isPageResultResume(resumed)) throw new Error("page_result_resume_required");
      return {
        context: {
          ...resumed.context,
          memory: state.context?.memory,
          actorRoles: resumed.context.actorRoles ?? state.context?.actorRoles,
          currentPlanStep: state.plan?.planStep ?? resumed.context.currentPlanStep ?? state.context?.currentPlanStep,
        },
        status: "running" as const,
      };
    })
    .addNode("wait_for_user", (state: GraphState) => {
      const resumed = interrupt({
        type: "user_input",
        plan: state.plan,
        question: state.plan?.userInputRequest?.question,
        requestedFields: state.plan?.userInputRequest?.requestedFields ?? [],
      });
      if (!isUserInputResume(resumed)) throw new Error("user_input_resume_required");
      return {
        taskText: `${state.taskText}\n用户补充信息：${resumed.text.trim()}`,
        context: {
          ...state.context,
          backendToolResults: state.plan?.backendToolResults ?? state.context?.backendToolResults,
          currentPlanStep: state.plan?.planStep ?? state.context?.currentPlanStep,
        },
        status: "running" as const,
      };
    })
    .addNode("complete", () => ({
      status: "completed" as const,
    }))
    .addEdge(START, "draft_task_plan")
    .addEdge("draft_task_plan", "plan_agent")
    .addConditionalEdges("plan_agent", (state: GraphState) => {
      if (state.plan?.userInputRequest) return "wait_for_user";
      if ((state.plan?.toolCalls.length ?? 0) > 0) return "wait_for_page";
      return "complete";
    })
    .addEdge("wait_for_page", "plan_agent")
    .addEdge("wait_for_user", "plan_agent")
    .addEdge("complete", END)
    .compile({ checkpointer: this.checkpointer });

  setPlannerForTesting(planner: typeof requestAgentPlan) {
    this.planner = planner;
  }

  setTaskPlannerForTesting(planner: typeof requestTaskPlan) {
    this.taskPlanner = async (...args): Promise<AssistantTaskBlueprint> => ({
      intent: { mode: "unknown", summary: args[0], objectives: [] },
      shouldPlan: true,
      steps: await planner(...args),
    });
  }

  setMemoryForTesting(input: {
    load: typeof loadAssistantMemory;
    remember: typeof rememberAssistantTurn;
  }) {
    this.memoryLoader = input.load;
    this.memoryWriter = input.remember;
  }

  private isTerminal(result: AssistantTaskResult) {
    return result.status === "completed" || result.status === "cancelled";
  }

  private pruneTaskCache(now = Date.now()) {
    for (const [taskId, cached] of this.latestResults) {
      if (this.isTerminal(cached.result) && now - cached.touchedAt >= ASSISTANT_TASK_CACHE_TTL_MS) {
        this.latestResults.delete(taskId);
      }
    }
    while (this.latestResults.size > ASSISTANT_TASK_CACHE_MAX) {
      const oldestTerminal = [...this.latestResults].find(([, cached]) => this.isTerminal(cached.result));
      if (!oldestTerminal) break;
      this.latestResults.delete(oldestTerminal[0]);
    }
  }

  private cacheTask(result: AssistantTaskResult) {
    this.latestResults.delete(result.taskId);
    this.latestResults.set(result.taskId, { result, touchedAt: Date.now() });
    this.pruneTaskCache();
    return result;
  }

  private cachedTask(taskId: string) {
    this.pruneTaskCache();
    const cached = this.latestResults.get(taskId);
    if (!cached) return null;
    cached.touchedAt = Date.now();
    return cached.result;
  }

  async onModuleInit() {
    await this.ensureReady();
  }

  async onModuleDestroy() {
    if (this.postgresCheckpointer) await this.postgresCheckpointer.end();
  }

  private async ensureReady() {
    if (!this.postgresCheckpointer) return;
    this.setupPromise ??= this.postgresCheckpointer.setup();
    await this.setupPromise;
  }

  private config(taskId: string) {
    return { configurable: { thread_id: taskId } };
  }

  private toTaskResult(taskId: string, result: GraphState & {
    __interrupt__?: Array<{ value?: InterruptPayload }>;
  }): AssistantTaskResult {
    const payload = result.__interrupt__?.[0]?.value;
    const status: AssistantTaskStatus = result.status === "cancelled"
      ? "cancelled"
      : payload?.type === "page_actions"
        ? "waiting_page"
        : payload?.type === "user_input"
          ? "waiting_user"
          : result.status === "running"
            ? "running"
            : "completed";
    return {
      taskId,
      status,
      plan: payload?.plan ?? result.plan ?? null,
      taskPlan: result.taskPlan ?? [],
      taskIntent: result.taskIntent ?? { mode: "unknown", summary: "", objectives: [] },
      context: result.context ? { ...result.context, taskIntent: result.taskIntent, memory: undefined } : undefined,
      question: typeof payload?.question === "string" ? payload.question : undefined,
      requestedFields: Array.isArray(payload?.requestedFields)
        ? payload.requestedFields.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }

  private async loadPersistedTask(taskId: string) {
    await this.ensureReady();
    const snapshot = await this.graph.getState(this.config(taskId));
    const values = snapshot.values as GraphState | undefined;
    const checkpointId = snapshot.config.configurable?.checkpoint_id;
    if (!checkpointId || !values || Object.keys(values).length === 0) return null;
    if (values.actorUserId) this.taskOwners.set(taskId, values.actorUserId);
    const payload = snapshot.tasks
      .flatMap((task) => task.interrupts)
      .map((item) => item.value)
      .find((item): item is InterruptPayload => Boolean(item) && typeof item === "object");
    return this.toTaskResult(taskId, {
      ...values,
      __interrupt__: payload ? [{ value: payload }] : undefined,
    });
  }

  private async currentTask(taskId: string, actorUserId?: string) {
    const current = this.cachedTask(taskId);
    if (current) {
      this.assertTaskOwner(taskId, actorUserId);
      return current;
    }
    const persisted = await this.loadPersistedTask(taskId);
    this.assertTaskOwner(taskId, actorUserId);
    if (persisted) this.cacheTask(persisted);
    return persisted;
  }

  private assertTaskOwner(taskId: string, actorUserId?: string) {
    const owner = this.taskOwners.get(taskId);
    if (actorUserId && owner !== actorUserId) throw new Error("assistant_task_not_found");
  }

  private async rememberCompletedTask(taskId: string, state: GraphState, response: AssistantTaskResult) {
    if (response.status !== "completed" || !state.actorUserId || !state.actorUsername || !response.plan) return;
    try {
      await this.memoryWriter({
        taskId,
        userId: state.actorUserId,
        username: state.actorUsername,
        userText: state.taskText,
        assistantReply: response.plan.reply,
        recognized: response.plan.recognized,
        toolCalls: [
          ...(state.context?.history ?? []).flatMap((round) => round.toolCalls.map(formatToolCall)),
          ...(response.plan.discoverySteps ?? []),
          ...response.plan.toolCalls.map(formatToolCall),
        ],
        pagePath: state.context?.currentPagePath,
      });
    } catch {
      console.warn(`[assistant-memory] failed to persist task=${taskId}`);
    }
  }

  async startTask(input: {
    taskId?: string;
    text: string;
    provider: LlmProvider;
    context?: AssistantContinuationContext;
    actor?: { userId: string; username: string };
  }) {
    await this.ensureReady();
    const taskId = input.taskId ?? randomUUID();
    if (this.cachedTask(taskId)) throw new Error("assistant_task_already_exists");
    if (input.actor) this.taskOwners.set(taskId, input.actor.userId);
    this.cacheTask({
      taskId,
      status: "running",
      plan: null,
      taskPlan: [],
      taskIntent: { mode: "unknown", summary: "", objectives: [] },
      context: input.context,
    });
    const persisted = await this.loadPersistedTask(taskId);
    if (persisted) {
      this.cacheTask(persisted);
      throw new Error("assistant_task_already_exists");
    }
    if (this.cachedTask(taskId)?.status === "cancelled") {
      return this.cachedTask(taskId)!;
    }
    const memory = input.actor
      ? await this.memoryLoader(input.actor.userId).catch(() => ({ recentTurns: [] }))
      : undefined;
    const result = await this.graph.invoke({
      taskText: input.text,
      provider: input.provider,
      context: { ...input.context, memory },
      actorUserId: input.actor?.userId,
      actorUsername: input.actor?.username,
      plan: null,
      taskPlan: [],
      taskIntent: { mode: "unknown", summary: input.text, objectives: [] },
      status: "running",
    }, this.config(taskId)) as GraphState & { __interrupt__?: Array<{ value?: Record<string, unknown> }> };
    const response = this.toTaskResult(taskId, result);
    if (this.cachedTask(taskId)?.status === "cancelled") {
      await this.graph.updateState(this.config(taskId), { status: "cancelled" });
      return this.cachedTask(taskId)!;
    }
    await this.rememberCompletedTask(taskId, result, response);
    return this.cacheTask(response);
  }

  async resumeTask(taskId: string, resume: AssistantTaskResume, actorUserId?: string) {
    await this.ensureReady();
    const current = await this.currentTask(taskId, actorUserId);
    if (!current) throw new Error("assistant_task_not_found");
    if (current.status === "cancelled") throw new Error("assistant_task_cancelled");
    if (current.status === "completed") return current;

    const result = await this.graph.invoke(
      new Command({ resume }),
      this.config(taskId),
    ) as GraphState & { __interrupt__?: Array<{ value?: Record<string, unknown> }> };
    const response = this.toTaskResult(taskId, result);
    await this.rememberCompletedTask(taskId, result, response);
    return this.cacheTask(response);
  }

  async cancelTask(taskId: string, actorUserId?: string) {
    await this.ensureReady();
    const current = await this.currentTask(taskId, actorUserId);
    if (!current) throw new Error("assistant_task_not_found");
    const cancelled: AssistantTaskResult = {
      ...current,
      status: "cancelled",
    };
    this.cacheTask(cancelled);
    try {
      await this.graph.updateState(this.config(taskId), { status: "cancelled" });
    } catch {
      // Cancelling can race with the first planner call before a checkpoint exists.
      // The in-memory task record remains authoritative until graph.invoke returns.
    }
    return cancelled;
  }

  async getTask(taskId: string, actorUserId?: string) {
    const current = await this.currentTask(taskId, actorUserId);
    if (!current) throw new Error("assistant_task_not_found");
    return current;
  }
}
