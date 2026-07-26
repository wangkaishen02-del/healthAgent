import { Module } from "@nestjs/common";
import { AssistantController } from "./assistant.controller.ts";
import { AssistantGraphService } from "./assistant-graph.service.ts";

@Module({
  controllers: [AssistantController],
  providers: [AssistantGraphService],
})
export class AssistantModule {}
