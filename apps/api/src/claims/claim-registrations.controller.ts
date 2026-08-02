import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Inject, NotFoundException, Patch, Post, Put, Query } from "@nestjs/common";
import type { ClaimCaseStatus, CreateClaimCaseInput } from "../../../../src/claims/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { ClaimsService } from "./claims.service.ts";
import { isClaimCaseInput } from "./claim-validation.ts";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function throwClaimError(error: unknown, mutation = false): never {
  if (error instanceof ConflictException) throw error;
  const message = error instanceof Error ? error.message : "claim_operation_failed";
  if (message.endsWith("_not_found")) throw new NotFoundException(message);
  if (mutation && (message.endsWith("_locked") || message.endsWith("_editable"))) throw new ConflictException(message);
  throw new BadRequestException(message);
}

@Controller("claim-registrations")
export class ClaimRegistrationsController {
  constructor(
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const filterKeys = ["id", "keyword", "caseNo", "policyNo", "insuredName", "insuredIdNo", "status", "reportDateFrom", "reportDateTo", "page", "pageSize"];
    if (!filterKeys.some((key) => query[key] !== undefined)) return { items: await this.claims.listCases() };
    const statuses = query.status?.split(",").filter(Boolean) ?? [];
    if (statuses.some((status) => !["registered", "entering", "calculating", "reviewing", "completed", "cancelled"].includes(status))) {
      throw new BadRequestException("invalid_claim_status");
    }
    return this.claims.queryCases({
      id: query.id,
      keyword: query.keyword,
      caseNo: query.caseNo,
      policyNo: query.policyNo,
      insuredName: query.insuredName,
      insuredIdNo: query.insuredIdNo,
      status: statuses.length > 1 ? statuses as ClaimCaseStatus[] : statuses[0] as ClaimCaseStatus | undefined,
      reportDateFrom: query.reportDateFrom,
      reportDateTo: query.reportDateTo,
      page: positiveNumber(query.page, 1),
      pageSize: positiveNumber(query.pageSize, 20),
    });
  }

  @Post()
  async create(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    if (!isClaimCaseInput(body)) throw new BadRequestException("invalid_claim_case");
    try {
      return await this.idempotency.execute("claim_case:create", operationKey, body, () => this.claims.createCase(body));
    } catch (error) { throwClaimError(error); }
  }

  @Put()
  async update(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string" || !isClaimCaseInput(body)) {
      throw new BadRequestException("invalid_claim_case");
    }
    try {
      const input = body as CreateClaimCaseInput & { id: string };
      const result = await this.idempotency.execute(
        "claim_case:update",
        operationKey,
        input,
        () => this.claims.updateCase(input.id, input),
      );
      if (!result) throw new NotFoundException("claim_case_not_found");
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwClaimError(error, true);
    }
  }

  @Patch()
  async changeStatus(
    @Body() body: { id?: unknown; action?: unknown },
    @Headers("idempotency-key") operationKey?: string,
  ) {
    if (!body || typeof body.id !== "string" || !["submit", "review", "complete", "cancel", "rollback"].includes(String(body.action))) {
      throw new BadRequestException("invalid_claim_action");
    }
    try {
      const result = await this.idempotency.execute(
        `claim_case:${body.action}`,
        operationKey,
        body,
        () => body.action === "rollback"
          ? this.claims.rollbackCase(body.id as string)
          : this.claims.changeCaseStatus(
            body.id as string,
            body.action === "submit" ? "entering" : body.action === "review" ? "reviewing" : body.action === "complete" ? "completed" : "cancelled",
          ),
      );
      if (!result) throw new NotFoundException("claim_case_not_found");
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwClaimError(error, true);
    }
  }
}
