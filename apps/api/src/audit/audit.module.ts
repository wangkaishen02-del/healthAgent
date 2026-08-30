import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditController } from "./audit.controller.ts";
import { AuditInterceptor } from "./audit.interceptor.ts";
import { AuditService } from "./audit.service.ts";

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
