import { Module } from "@nestjs/common";
import { AttachmentsController } from "./attachments.controller.ts";

@Module({ controllers: [AttachmentsController] })
export class AttachmentsModule {}
