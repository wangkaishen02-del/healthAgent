import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";
import { UnderwritingModule } from "./underwriting/underwriting.module.ts";
import { ClaimsModule } from "./claims/claims.module.ts";
import { CalculationModule } from "./calculation/calculation.module.ts";
import { AssistantModule } from "./assistant/assistant.module.ts";
import { AttachmentsModule } from "./attachments/attachments.module.ts";
import { IdempotencyModule } from "./idempotency/idempotency.module.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { AuditModule } from "./audit/audit.module.ts";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, IdempotencyModule, UnderwritingModule, ClaimsModule, CalculationModule, AssistantModule, AttachmentsModule],
  controllers: [HealthController],
})
export class AppModule {}
