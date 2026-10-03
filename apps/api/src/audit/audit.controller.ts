import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import { Roles } from "../auth/auth.decorators.ts";
import { CurrentUser } from "../auth/auth.decorators.ts";
import type { AuthenticatedUser } from "../auth/auth.types.ts";
import { AuditService } from "./audit.service.ts";

const CLICK_ACTIONS = new Set(["claim_search", "claim_view", "claim_transition_history_view"]);

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
      actorKeyword: query.actorKeyword?.trim() || undefined,
      resourceType: query.resourceType?.trim() || undefined,
      caseNo: query.caseNo?.trim() || undefined,
      action: query.action?.trim() || undefined,
    });
  }

  @Post("events")
  @Roles("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer")
  async recordClick(
    @Body() body: { action?: unknown; caseId?: unknown; description?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const action = typeof body.action === "string" ? body.action : "";
    const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
    if (!CLICK_ACTIONS.has(action) || (action !== "claim_search" && !caseId)) throw new BadRequestException("invalid_audit_click_event");
    await this.auditService.record({
      user,
      method: "CLICK",
      path: "/ui/claim",
      action,
      description: typeof body.description === "string" ? body.description : undefined,
      resourceType: "claim_case",
      resourceId: caseId || undefined,
      outcome: "success",
      statusCode: 201,
      requestId: `ui-${Date.now()}`,
    });
    return { ok: true };
  }
}
