import { Module } from "@nestjs/common";
import { CalculationController } from "./calculation.controller.ts";
import { CalculationService } from "./calculation.service.ts";
import { UnderwritingModule } from "../underwriting/underwriting.module.ts";

@Module({
  imports: [UnderwritingModule],
  controllers: [CalculationController],
  providers: [CalculationService],
})
export class CalculationModule {}
