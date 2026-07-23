import { BadRequestException, Body, Controller, Delete, NotFoundException, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { removeClaimUpload, storeClaimUpload } from "../../../../src/claims/attachment-store.ts";
import type { ClaimAttachmentCategory } from "../../../../src/claims/types.ts";

const categories: ClaimAttachmentCategory[] = ["application", "identity", "medical", "invoice", "bank", "other"];

@Controller("claim-attachments")
export class AttachmentsController {
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body("category") category?: string) {
    if (!file || !categories.includes(category as ClaimAttachmentCategory)) {
      throw new BadRequestException("invalid_attachment");
    }
    try {
      return storeClaimUpload({
        fileName: file.originalname,
        mimeType: file.mimetype,
        data: new Uint8Array(file.buffer),
        category: category as ClaimAttachmentCategory,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "attachment_upload_failed");
    }
  }

  @Delete()
  remove(@Query("uploadId") uploadId?: string) {
    if (!uploadId) throw new BadRequestException("uploadId is required");
    if (!removeClaimUpload(uploadId)) throw new NotFoundException("attachment_not_found");
    return { success: true };
  }
}
