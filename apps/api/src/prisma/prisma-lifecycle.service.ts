import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { prisma } from "../../../../src/db/prisma.ts";

@Injectable()
export class PrismaLifecycleService implements OnModuleInit, OnApplicationShutdown {
  readonly client = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onApplicationShutdown() {
    await this.client.$disconnect();
  }
}
