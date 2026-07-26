import { Module } from "@nestjs/common";
import { AutomaticCalculationController, CalculationController } from "./calculation.controller.ts";
import { CalculationService } from "./calculation.service.ts";
import { UnderwritingModule } from "../underwriting/underwriting.module.ts";

@Module({
  imports: [UnderwritingModule],
  controllers: [CalculationController, AutomaticCalculationController],
  providers: [CalculationService],
})
export class CalculationModule {}
