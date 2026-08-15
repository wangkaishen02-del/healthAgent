import { Module } from "@nestjs/common";
import { ClaimEventsController } from "./claim-events.controller.ts";
import { ClaimRemarksController } from "./claim-remarks.controller.ts";
import { ClaimRegistrationsController } from "./claim-registrations.controller.ts";
import { ClaimsService } from "./claims.service.ts";
import { ReferenceDataController } from "./reference-data.controller.ts";

@Module({
  controllers: [ClaimEventsController, ClaimRemarksController, ClaimRegistrationsController, ReferenceDataController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
