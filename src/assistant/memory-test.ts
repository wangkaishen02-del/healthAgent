import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import {
  clearAssistantMemory,
  listAssistantMemory,
  loadAssistantMemory,
  rememberAssistantTurn,
} from "./memory-service.ts";

const suffix = randomUUID().slice(0, 8);
const userA = `memory-test-a-${suffix}`;
const userB = `memory-test-b-${suffix}`;
const taskA = `memory-task-a-${suffix}`;
const taskB = `memory-task-b-${suffix}`;

try {
  await rememberAssistantTurn({
    taskId: taskA,
    userId: userA,
    username: userA,
    userText: "继续查询刚才的案件",
    assistantReply: "已查询案件状态。",
    recognized: ["案件查询"],
    toolCalls: ["打开案件查询页面"],
    pagePath: ["综合查询", "案件查询"],
  });
  await rememberAssistantTurn({
    taskId: taskB,
    userId: userB,
    username: userB,
    userText: "查询我的保单",
    assistantReply: "已返回保单列表。",
  });

  const ownMemory = await loadAssistantMemory(userA);
  assert.equal(ownMemory.recentTurns.length, 1);
  assert.equal(ownMemory.recentTurns[0]?.taskId, taskA);
  assert.equal(ownMemory.recentTurns[0]?.toolCalls[0], "打开案件查询页面");
  assert.equal((await listAssistantMemory(userA, 50)).some((turn) => turn.taskId === taskB), false);

  await rememberAssistantTurn({
    taskId: taskA,
    userId: userA,
    username: userA,
    userText: "继续查询刚才的案件",
    assistantReply: "案件状态已刷新。",
  });
  const afterRetry = await listAssistantMemory(userA, 50);
  assert.equal(afterRetry.length, 1, "同一任务重试不能重复记忆");
  assert.equal(afterRetry[0]?.assistantReply, "案件状态已刷新。");

  assert.equal(await clearAssistantMemory(userA), 1);
  assert.equal((await listAssistantMemory(userA)).length, 0);
  assert.equal((await listAssistantMemory(userB)).length, 1, "清除记忆不能影响其他用户");
} finally {
  await prisma.assistantMemoryTurn.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await prisma.$disconnect();
}

console.log("Assistant memory tests passed");
