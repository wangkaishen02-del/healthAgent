import { Module } from "@nestjs/common";
import { ClaimEventsController } from "./claim-events.controller.ts";
import { ClaimRegistrationsController } from "./claim-registrations.controller.ts";
import { ClaimsService } from "./claims.service.ts";

@Module({
  controllers: [ClaimEventsController, ClaimRegistrationsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
