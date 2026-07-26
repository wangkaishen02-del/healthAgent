import { Global, Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service.ts";

@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
