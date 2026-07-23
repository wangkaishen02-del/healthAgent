import { Module } from "@nestjs/common";
import { AssistantController } from "./assistant.controller.ts";

@Module({ controllers: [AssistantController] })
export class AssistantModule {}
