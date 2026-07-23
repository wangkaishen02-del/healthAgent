import { BadRequestException, Body, Controller, Get, Inject, Post, Put, Query } from "@nestjs/common";
import type { ClaimEventInput } from "../../../../src/claims/types.ts";
import { ClaimsService } from "./claims.service.ts";
import { isClaimEventInput } from "./claim-validation.ts";

@Controller("claim-events")
export class ClaimEventsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Get()
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
  async create(@Body() body: unknown) {
    if (!body || typeof body !== "object" || typeof (body as { insuredPersonId?: unknown }).insuredPersonId !== "string" || !isClaimEventInput(body)) {
      throw new BadRequestException("invalid_claim_event");
    }
    try {
      const input = body as ClaimEventInput & { insuredPersonId: string };
      return await this.claims.createEvent(input.insuredPersonId, input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "claim_event_create_failed");
    }
  }

  @Put()
  async update(@Body() body: unknown) {
    if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string" || typeof (body as { insuredPersonId?: unknown }).insuredPersonId !== "string" || !isClaimEventInput(body)) {
      throw new BadRequestException("invalid_claim_event");
    }
    try {
      const input = body as ClaimEventInput & { id: string; insuredPersonId: string };
      return await this.claims.updateEvent(input.id, input.insuredPersonId, input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "claim_event_update_failed");
    }
  }
}
