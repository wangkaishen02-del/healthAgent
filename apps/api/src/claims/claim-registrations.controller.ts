import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Patch, Post, Put, Query } from "@nestjs/common";
import type { ClaimCaseStatus, CreateClaimCaseInput } from "../../../../src/claims/types.ts";
import { ClaimsService } from "./claims.service.ts";
import { isClaimCaseInput } from "./claim-validation.ts";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function throwClaimError(error: unknown, mutation = false): never {
  const message = error instanceof Error ? error.message : "claim_operation_failed";
  if (message.endsWith("_not_found")) throw new NotFoundException(message);
  if (mutation && (message.endsWith("_locked") || message.endsWith("_editable"))) throw new ConflictException(message);
  throw new BadRequestException(message);
}

@Controller("claim-registrations")
export class ClaimRegistrationsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const filterKeys = ["id", "caseNo", "policyNo", "insuredName", "insuredIdNo", "status", "reportDateFrom", "reportDateTo", "page", "pageSize"];
    if (!filterKeys.some((key) => query[key] !== undefined)) return { items: await this.claims.listCases() };
    if (query.status && !["registered", "submitted", "cancelled"].includes(query.status)) {
      throw new BadRequestException("invalid_claim_status");
    }
    return this.claims.queryCases({
      id: query.id,
      caseNo: query.caseNo,
      policyNo: query.policyNo,
      insuredName: query.insuredName,
      insuredIdNo: query.insuredIdNo,
      status: query.status as ClaimCaseStatus | undefined,
      reportDateFrom: query.reportDateFrom,
      reportDateTo: query.reportDateTo,
      page: positiveNumber(query.page, 1),
      pageSize: positiveNumber(query.pageSize, 20),
    });
  }

  @Post()
  async create(@Body() body: unknown) {
    if (!isClaimCaseInput(body)) throw new BadRequestException("invalid_claim_case");
    try { return await this.claims.createCase(body); } catch (error) { throwClaimError(error); }
  }

  @Put()
  async update(@Body() body: unknown) {
    if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string" || !isClaimCaseInput(body)) {
      throw new BadRequestException("invalid_claim_case");
    }
    try {
      const input = body as CreateClaimCaseInput & { id: string };
      const result = await this.claims.updateCase(input.id, input);
      if (!result) throw new NotFoundException("claim_case_not_found");
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwClaimError(error, true);
    }
  }

  @Patch()
  async changeStatus(@Body() body: { id?: unknown; action?: unknown }) {
    if (!body || typeof body.id !== "string" || (body.action !== "submit" && body.action !== "cancel")) {
      throw new BadRequestException("invalid_claim_action");
    }
    try {
      const result = await this.claims.changeCaseStatus(body.id, body.action === "submit" ? "submitted" : "cancelled");
      if (!result) throw new NotFoundException("claim_case_not_found");
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwClaimError(error, true);
    }
  }
}
