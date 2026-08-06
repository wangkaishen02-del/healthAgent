import assert from "node:assert/strict";
import { AssistantGraphService } from "../../apps/api/src/assistant/assistant-graph.service.ts";
import { buildSystemPrompt, requestAgentPlan } from "./plan-service.ts";

assert.match(buildSystemPrompt("帮我处理一下"), /requestedFields 使用 taskDescription/);
assert.match(buildSystemPrompt("帮我撤件"), /优先使用 ask_user 询问案件号/);
assert.match(buildSystemPrompt("继续刚才的任务"), /当前用户明确输入始终优先/);

const graphService = new AssistantGraphService();
const fakePlanner: typeof requestAgentPlan = async (text, _provider, context) => {
  const asksForUserInput = text.includes("需要补充") && !text.includes("用户补充信息");
  const hasPageResult = Boolean(context?.lastOperationResult);
  return {
    ok: true,
    rawReplies: [],
    plan: asksForUserInput
      ? {
          reply: "请补充被保人姓名。",
          recognized: [],
          decision: "finish",
          toolCalls: [],
          userInputRequest: {
            question: "请补充被保人姓名。",
            requestedFields: ["insuredName"],
          },
        }
      : hasPageResult || text.includes("用户补充信息")
        ? {
            reply: "任务完成。",
            recognized: [],
            decision: "finish",
            toolCalls: [],
          }
        : {
            reply: "打开查询页面。",
            recognized: [],
            decision: "continue",
            toolCalls: [{ tool: "open_page", args: { pageId: "policy_query" } }],
          },
  } as unknown as Awaited<ReturnType<typeof requestAgentPlan>>;
};
graphService.setPlannerForTesting(fakePlanner);

const pageTask = await graphService.startTask({
  taskId: "graph-smoke-page",
  text: "测试页面操作",
  provider: "ollama",
});
assert.equal(pageTask.status, "waiting_page");
assert.equal(pageTask.plan?.toolCalls[0]?.tool, "open_page");
const completedPageTask = await graphService.resumeTask(pageTask.taskId, {
  type: "page_result",
  context: { lastOperationResult: { type: "page_action", success: true } },
});
assert.equal(completedPageTask.status, "completed");

const userInputTask = await graphService.startTask({
  taskId: "graph-smoke-user-input",
  text: "这个任务需要补充",
  provider: "ollama",
});
assert.equal(userInputTask.status, "waiting_user");
assert.deepEqual(userInputTask.requestedFields, ["insuredName"]);
const completedUserInputTask = await graphService.resumeTask(userInputTask.taskId, {
  type: "user_input",
  text: "张晨",
});
assert.equal(completedUserInputTask.status, "completed");

const cancelledTask = await graphService.startTask({
  taskId: "graph-smoke-cancel",
  text: "测试取消",
  provider: "ollama",
});
assert.equal((await graphService.cancelTask(cancelledTask.taskId)).status, "cancelled");
await assert.rejects(
  graphService.resumeTask(cancelledTask.taskId, {
    type: "page_result",
    context: { lastOperationResult: { type: "page_action" } },
  }),
  /assistant_task_cancelled/,
);

graphService.setPlannerForTesting((async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    ok: true,
    rawReplies: [],
    plan: {
      reply: "不应覆盖取消状态。",
      recognized: [],
      decision: "finish",
      toolCalls: [],
    },
  } as unknown as Awaited<ReturnType<typeof requestAgentPlan>>;
}) as typeof requestAgentPlan);
const startingTask = graphService.startTask({
  taskId: "graph-smoke-cancel-during-plan",
  text: "规划过程中取消",
  provider: "ollama",
});
assert.equal(
  (await graphService.cancelTask("graph-smoke-cancel-during-plan")).status,
  "cancelled",
);
assert.equal((await startingTask).status, "cancelled");

const remembered: Array<{ taskId: string; userId: string; assistantReply: string }> = [];
let loadedMemoryUser = "";
const memoryGraph = new AssistantGraphService();
memoryGraph.setMemoryForTesting({
  load: async (userId) => {
    loadedMemoryUser = userId;
    return {
      recentTurns: [{
        taskId: "previous-task",
        userText: "查询案件 CL202607260011",
        assistantReply: "案件处于理算状态。",
        recognized: ["CL202607260011"],
        toolCalls: [],
        pagePath: ["综合查询", "案件查询"],
        createdAt: new Date().toISOString(),
      }],
    };
  },
  remember: async (input) => {
    remembered.push({ taskId: input.taskId, userId: input.userId, assistantReply: input.assistantReply });
  },
});
const memoryPlanner: typeof requestAgentPlan = async (_text, _provider, context) => ({
  ok: true,
  rawReplies: [],
  plan: {
    reply: context?.memory?.recentTurns[0]?.assistantReply ?? "没有历史记忆",
    recognized: [],
    decision: "finish",
    toolCalls: [],
  },
}) as unknown as Awaited<ReturnType<typeof requestAgentPlan>>;
memoryGraph.setPlannerForTesting(memoryPlanner);
const memoryTask = await memoryGraph.startTask({
  taskId: "graph-smoke-memory",
  text: "继续刚才的任务",
  provider: "deepseek",
  actor: { userId: "user-a", username: "user-a" },
});
assert.equal(loadedMemoryUser, "user-a");
assert.equal(memoryTask.plan?.reply, "案件处于理算状态。");
assert.equal(remembered.length, 1);
assert.equal(memoryTask.context?.memory, undefined, "历史记忆不能回传到浏览器任务上下文");
await assert.rejects(memoryGraph.getTask(memoryTask.taskId, "user-b"), /assistant_task_not_found/);

console.log("LangGraph assistant task tests passed");
