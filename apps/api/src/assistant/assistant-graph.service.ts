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
  type AssistantContinuationContext,
  type LlmProvider,
} from "../../../../src/assistant/plan-service.ts";
import type { AssistantPlan } from "../../../../src/assistant/policy-query-assistant.ts";

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
  context?: AssistantContinuationContext;
  question?: string;
  requestedFields?: string[];
};

const AssistantGraphState = Annotation.Root({
  taskText: Annotation<string>,
  provider: Annotation<LlmProvider>,
  context: Annotation<AssistantContinuationContext | undefined>,
  plan: Annotation<AssistantPlan | null>,
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
  private readonly latestResults = new Map<string, AssistantTaskResult>();
  private planner: typeof requestAgentPlan = requestAgentPlan;

  private readonly graph = new StateGraph(AssistantGraphState)
    .addNode("plan_agent", async (state: GraphState) => {
      const result = await this.planner(state.taskText, state.provider, state.context);
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
        context: resumed.context,
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
        status: "running" as const,
      };
    })
    .addNode("complete", () => ({
      status: "completed" as const,
    }))
    .addEdge(START, "plan_agent")
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
          : "completed";
    return {
      taskId,
      status,
      plan: payload?.plan ?? result.plan ?? null,
      context: result.context,
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
    const payload = snapshot.tasks
      .flatMap((task) => task.interrupts)
      .map((item) => item.value)
      .find((item): item is InterruptPayload => Boolean(item) && typeof item === "object");
    return this.toTaskResult(taskId, {
      ...values,
      __interrupt__: payload ? [{ value: payload }] : undefined,
    });
  }

  private async currentTask(taskId: string) {
    const current = this.latestResults.get(taskId);
    if (current) return current;
    const persisted = await this.loadPersistedTask(taskId);
    if (persisted) this.latestResults.set(taskId, persisted);
    return persisted;
  }

  async startTask(input: {
    taskId?: string;
    text: string;
    provider: LlmProvider;
    context?: AssistantContinuationContext;
  }) {
    await this.ensureReady();
    const taskId = input.taskId ?? randomUUID();
    if (this.latestResults.has(taskId)) throw new Error("assistant_task_already_exists");
    this.latestResults.set(taskId, {
      taskId,
      status: "running",
      plan: null,
      context: input.context,
    });
    const persisted = await this.loadPersistedTask(taskId);
    if (persisted) {
      this.latestResults.set(taskId, persisted);
      throw new Error("assistant_task_already_exists");
    }
    if (this.latestResults.get(taskId)?.status === "cancelled") {
      return this.latestResults.get(taskId)!;
    }
    const result = await this.graph.invoke({
      taskText: input.text,
      provider: input.provider,
      context: input.context,
      plan: null,
      status: "running",
    }, this.config(taskId)) as GraphState & { __interrupt__?: Array<{ value?: Record<string, unknown> }> };
    const response = this.toTaskResult(taskId, result);
    if (this.latestResults.get(taskId)?.status === "cancelled") {
      await this.graph.updateState(this.config(taskId), { status: "cancelled" });
      return this.latestResults.get(taskId)!;
    }
    this.latestResults.set(taskId, response);
    return response;
  }

  async resumeTask(taskId: string, resume: AssistantTaskResume) {
    await this.ensureReady();
    const current = await this.currentTask(taskId);
    if (!current) throw new Error("assistant_task_not_found");
    if (current.status === "cancelled") throw new Error("assistant_task_cancelled");
    if (current.status === "completed") return current;

    const result = await this.graph.invoke(
      new Command({ resume }),
      this.config(taskId),
    ) as GraphState & { __interrupt__?: Array<{ value?: Record<string, unknown> }> };
    const response = this.toTaskResult(taskId, result);
    this.latestResults.set(taskId, response);
    return response;
  }

  async cancelTask(taskId: string) {
    await this.ensureReady();
    const current = await this.currentTask(taskId);
    if (!current) throw new Error("assistant_task_not_found");
    const cancelled: AssistantTaskResult = {
      ...current,
      status: "cancelled",
    };
    this.latestResults.set(taskId, cancelled);
    try {
      await this.graph.updateState(this.config(taskId), { status: "cancelled" });
    } catch {
      // Cancelling can race with the first planner call before a checkpoint exists.
      // The in-memory task record remains authoritative until graph.invoke returns.
    }
    return cancelled;
  }

  async getTask(taskId: string) {
    const current = await this.currentTask(taskId);
    if (!current) throw new Error("assistant_task_not_found");
    return current;
  }
}
