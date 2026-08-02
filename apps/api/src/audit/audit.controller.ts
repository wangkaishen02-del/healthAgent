import { Controller, Get, Inject, Query } from "@nestjs/common";
import { Roles } from "../auth/auth.decorators.ts";
import { AuditService } from "./audit.service.ts";

@Controller("audit-logs")
@Roles("claim_admin")
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    return this.auditService.list({
      page,
      pageSize,
      actorUserId: query.actorUserId?.trim() || undefined,
      resourceType: query.resourceType?.trim() || undefined,
    });
  }
}
