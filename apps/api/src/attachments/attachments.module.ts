import { Module } from "@nestjs/common";
import { AttachmentOcrService } from "./attachment-ocr.service.ts";
import { AttachmentsController } from "./attachments.controller.ts";

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentOcrService],
  exports: [AttachmentOcrService],
})
export class AttachmentsModule {}
