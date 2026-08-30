import "../../apps/api/src/load-env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AssistantGraphService } from "../../apps/api/src/assistant/assistant-graph.service.ts";
import { requestAgentPlan } from "./plan-service.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const taskId = `graph-postgres-${randomUUID()}`;
const planner: typeof requestAgentPlan = async (text) => ({
  ok: true,
  rawReplies: [],
  plan: text.includes("用户补充信息")
    ? {
        reply: "任务完成。",
        recognized: [],
        decision: "finish",
        toolCalls: [],
        discoverySteps: [],
        discoveryResults: [],
        backendToolResults: [],
      }
    : {
        reply: "请补充案件号。",
        recognized: [],
        decision: "finish",
        toolCalls: [],
        userInputRequest: {
          question: "请补充案件号。",
          requestedFields: ["caseNo"],
        },
      },
} as Awaited<ReturnType<typeof requestAgentPlan>>);

const firstService = new AssistantGraphService();
firstService.setPlannerForTesting(planner);
firstService.setTaskPlannerForTesting(async () => ["确认案件目标", "补充必要信息", "返回案件详情"]);
await firstService.onModuleInit();
const interrupted = await firstService.startTask({
  taskId,
  text: "打开案件详情",
  provider: "ollama",
});
assert.equal(interrupted.status, "waiting_user");
await firstService.onModuleDestroy();

const restoredService = new AssistantGraphService();
restoredService.setPlannerForTesting(planner);
restoredService.setTaskPlannerForTesting(async () => ["确认案件目标", "补充必要信息", "返回案件详情"]);
await restoredService.onModuleInit();
assert.equal((await restoredService.getTask(taskId)).status, "waiting_user");
await assert.rejects(
  restoredService.startTask({ taskId, text: "重复任务", provider: "ollama" }),
  /assistant_task_already_exists/,
);
const completed = await restoredService.resumeTask(taskId, {
  type: "user_input",
  text: "CL202607220001",
});
assert.equal(completed.status, "completed");
await restoredService.onModuleDestroy();

const cleaner = PostgresSaver.fromConnString(process.env.DATABASE_URL, { schema: "langgraph" });
await cleaner.setup();
await cleaner.deleteThread(taskId);
await cleaner.end();

console.log("LangGraph PostgreSQL recovery tests passed");
