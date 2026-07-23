import { Global, Module } from "@nestjs/common";
import { PrismaLifecycleService } from "./prisma-lifecycle.service.ts";

@Global()
@Module({
  providers: [PrismaLifecycleService],
  exports: [PrismaLifecycleService],
})
export class PrismaModule {}
