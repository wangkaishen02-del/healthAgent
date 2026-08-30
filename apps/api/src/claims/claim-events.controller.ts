import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Inject, Post, Put, Query } from "@nestjs/common";
import type { ClaimEventInput } from "../../../../src/claims/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { ClaimsService } from "./claims.service.ts";
import { isClaimEventInput } from "./claim-validation.ts";
import { Roles } from "../auth/auth.decorators.ts";

@Controller("claim-events")
export class ClaimEventsController {
  constructor(
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Roles("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer")
  async list(@Query() query: Record<string, string | undefined>) {
    if (!query.insuredPersonId) throw new BadRequestException("insured_person_required");
    return { items: await this.claims.listEvents({
      insuredPersonId: query.insuredPersonId,
      keyword: query.keyword,
      eventType: query.eventType,
      occurredDate: query.occurredDate,
    }) };
  }

  @Post()
  @Roles("claim_acceptor", "claim_calculator")
  async create(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    if (!body || typeof body !== "object" || typeof (body as { insuredPersonId?: unknown }).insuredPersonId !== "string" || !isClaimEventInput(body)) {
      throw new BadRequestException("invalid_claim_event");
    }
    try {
      const input = body as ClaimEventInput & { insuredPersonId: string };
      return await this.idempotency.execute(
        "claim_event:create",
        operationKey,
        input,
        () => this.claims.createEvent(input.insuredPersonId, input),
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : "claim_event_create_failed");
    }
  }

  @Put()
  @Roles("claim_acceptor", "claim_calculator")
  async update(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string" || typeof (body as { insuredPersonId?: unknown }).insuredPersonId !== "string" || !isClaimEventInput(body)) {
      throw new BadRequestException("invalid_claim_event");
    }
    try {
      const input = body as ClaimEventInput & { id: string; insuredPersonId: string };
      return await this.idempotency.execute(
        "claim_event:update",
        operationKey,
        input,
        () => this.claims.updateEvent(input.id, input.insuredPersonId, input),
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : "claim_event_update_failed");
    }
  }
}
