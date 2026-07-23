import { Module } from "@nestjs/common";
import { PoliciesController } from "./policies.controller.ts";
import { UnderwritingService } from "./underwriting.service.ts";

@Module({
  controllers: [PoliciesController],
  providers: [UnderwritingService],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}
