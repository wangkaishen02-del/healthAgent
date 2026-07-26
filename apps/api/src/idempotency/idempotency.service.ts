import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaLifecycleService } from "../prisma/prisma-lifecycle.service.ts";

function normalizedJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaLifecycleService) private readonly prisma: PrismaLifecycleService) {}

  async execute<T>(
    scope: string,
    operationKey: string | undefined,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = operationKey?.trim();
    if (!key) return operation();
    if (key.length > 200) throw new ConflictException("idempotency_key_too_long");

    const hash = requestHash(request);
    const existing = await this.prisma.client.idempotencyRecord.findUnique({
      where: { scope_operationKey: { scope, operationKey: key } },
    });
    if (existing) {
      if (existing.requestHash !== hash) throw new ConflictException("idempotency_key_reused");
      if (existing.status === "completed" && existing.response !== null) {
        return existing.response as T;
      }
      throw new ConflictException("idempotency_operation_in_progress");
    }

    try {
      await this.prisma.client.idempotencyRecord.create({
        data: {
          id: randomUUID(),
          scope,
          operationKey: key,
          requestHash: hash,
          status: "pending",
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.execute(scope, key, request, operation);
      }
      throw error;
    }

    try {
      const result = await operation();
      await this.prisma.client.idempotencyRecord.update({
        where: { scope_operationKey: { scope, operationKey: key } },
        data: {
          status: "completed",
          response: normalizedJson(result),
        },
      });
      return result;
    } catch (error) {
      await this.prisma.client.idempotencyRecord.delete({
        where: { scope_operationKey: { scope, operationKey: key } },
      }).catch(() => undefined);
      throw error;
    }
  }
}
