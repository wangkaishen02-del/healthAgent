import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { healthAgentPrisma?: PrismaClient };

export const prisma = globalForPrisma.healthAgentPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.healthAgentPrisma = prisma;
