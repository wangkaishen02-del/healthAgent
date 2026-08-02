import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaLifecycleService } from "../prisma/prisma-lifecycle.service.ts";
import type { AuthenticatedUser } from "../auth/auth.types.ts";

export type OperationAuditInput = {
  user: AuthenticatedUser;
  method: string;
  path: string;
  resourceType: string;
  resourceId?: string;
  outcome: "success" | "failure";
  statusCode: number;
  errorCode?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuditService {
  private readonly lastSnapshotAt = new Map<string, number>();

  constructor(@Inject(PrismaLifecycleService) private readonly prismaService: PrismaLifecycleService) {}

  async record(input: OperationAuditInput) {
    await this.prismaService.client.operationAudit.create({
      data: {
        id: randomUUID(),
        actorUserId: input.user.id,
        actorUsername: input.user.username,
        actorName: input.user.displayName,
        actorRoles: input.user.roles,
        method: input.method,
        path: input.path,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: input.outcome,
        statusCode: input.statusCode,
        errorCode: input.errorCode,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 300),
      },
    });
  }

  async observeUser(user: AuthenticatedUser) {
    const now = Date.now();
    if (now - (this.lastSnapshotAt.get(user.id) ?? 0) < 5 * 60_000) return;
    this.lastSnapshotAt.set(user.id, now);
    try {
      await this.prismaService.client.appUserSnapshot.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          roles: user.roles,
        },
        update: {
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          roles: user.roles,
          lastSeenAt: new Date(),
        },
      });
    } catch {
      this.lastSnapshotAt.delete(user.id);
    }
  }

  async list(input: { page: number; pageSize: number; actorUserId?: string; resourceType?: string }) {
    const where = {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
    };
    const [total, items] = await this.prismaService.client.$transaction([
      this.prismaService.client.operationAudit.count({ where }),
      this.prismaService.client.operationAudit.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }
}
