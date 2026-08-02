import { BadRequestException, Body, ConflictException, Controller, Headers, Inject, NotFoundException, Post } from "@nestjs/common";
import type { ClaimRemarkStage } from "../../../../src/claims/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { ClaimsService } from "./claims.service.ts";

const remarkStages: ClaimRemarkStage[] = ["acceptance", "calculation", "review"];

@Controller("claim-remarks")
export class ClaimRemarksController {
  constructor(
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  async create(
    @Body() body: { claimCaseId?: unknown; stage?: unknown; content?: unknown },
    @Headers("idempotency-key") operationKey?: string,
  ) {
    if (!body || typeof body.claimCaseId !== "string" || typeof body.stage !== "string" || !remarkStages.includes(body.stage as ClaimRemarkStage) || typeof body.content !== "string" || !body.content.trim()) {
      throw new BadRequestException("invalid_claim_remark");
    }
    try {
      return await this.idempotency.execute(
        "claim_remark:create",
        operationKey,
        body,
        () => this.claims.createRemark(body.claimCaseId as string, body.stage as ClaimRemarkStage, body.content as string),
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const message = error instanceof Error ? error.message : "claim_remark_create_failed";
      if (message === "claim_case_not_found") throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }
}
