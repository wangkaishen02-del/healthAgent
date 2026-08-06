import { prisma } from "../db/prisma.ts";

export type AssistantMemoryTurnView = {
  taskId: string;
  userText: string;
  assistantReply: string;
  recognized: string[];
  toolCalls: string[];
  pagePath: string[];
  createdAt: string;
};

export type AssistantMemorySnapshot = {
  recentTurns: AssistantMemoryTurnView[];
};

const DEFAULT_PROMPT_TURNS = 8;
const MAX_LIST_TURNS = 50;
const STORED_TURN_LIMIT = boundedNumber(process.env.ASSISTANT_MEMORY_MAX_TURNS, 30, 5, 100);

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function text(value: unknown, maxLength = 3_000) {
  return typeof value === "string" ? [...value.trim()].slice(0, maxLength).join("") : "";
}

function stringList(value: unknown, maxItems = 20, maxLength = 300) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => text(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function toView(turn: {
  taskId: string;
  userText: string;
  assistantReply: string;
  recognized: unknown;
  toolCalls: unknown;
  pagePath: unknown;
  createdAt: Date;
}): AssistantMemoryTurnView {
  return {
    taskId: turn.taskId,
    userText: turn.userText,
    assistantReply: turn.assistantReply,
    recognized: stringList(turn.recognized),
    toolCalls: stringList(turn.toolCalls),
    pagePath: stringList(turn.pagePath, 8, 100),
    createdAt: turn.createdAt.toISOString(),
  };
}

export async function listAssistantMemory(userId: string, limit = DEFAULT_PROMPT_TURNS) {
  const safeLimit = Math.min(MAX_LIST_TURNS, Math.max(1, Math.floor(limit)));
  const turns = await prisma.assistantMemoryTurn.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: safeLimit,
  });
  return turns.reverse().map(toView);
}

export async function loadAssistantMemory(userId: string): Promise<AssistantMemorySnapshot> {
  return { recentTurns: await listAssistantMemory(userId, DEFAULT_PROMPT_TURNS) };
}

export async function rememberAssistantTurn(input: {
  taskId: string;
  userId: string;
  username: string;
  userText: string;
  assistantReply: string;
  recognized?: string[];
  toolCalls?: string[];
  pagePath?: string[];
}) {
  const data = {
    userId: text(input.userId, 100),
    username: text(input.username, 100),
    userText: text(input.userText),
    assistantReply: text(input.assistantReply),
    recognized: stringList(input.recognized),
    toolCalls: stringList(input.toolCalls),
    pagePath: stringList(input.pagePath, 8, 100),
  };
  if (!data.userId || !data.userText || !data.assistantReply) return;

  await prisma.assistantMemoryTurn.upsert({
    where: { taskId: input.taskId },
    create: { taskId: input.taskId, ...data },
    update: data,
  });

  const expired = await prisma.assistantMemoryTurn.findMany({
    where: { userId: data.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: STORED_TURN_LIMIT,
    select: { id: true },
  });
  if (expired.length) {
    await prisma.assistantMemoryTurn.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
  }
}

export async function clearAssistantMemory(userId: string) {
  const result = await prisma.assistantMemoryTurn.deleteMany({ where: { userId } });
  return result.count;
}
