import { BadRequestException, Body, Controller, Delete, Headers, Inject, NotFoundException, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { removeClaimUpload, storeClaimUpload } from "../../../../src/claims/attachment-store.ts";
import type { ClaimAttachmentCategory } from "../../../../src/claims/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";

const categories: ClaimAttachmentCategory[] = ["application", "identity", "medical", "invoice", "bank", "other"];

@Controller("claim-attachments")
export class AttachmentsController {
  constructor(@Inject(IdempotencyService) private readonly idempotency: IdempotencyService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("category") category?: string,
  ) {
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
  async remove(
    @Query("uploadId") uploadId?: string,
    @Headers("idempotency-key") operationKey?: string,
  ) {
    if (!uploadId) throw new BadRequestException("uploadId is required");
    return this.idempotency.execute(
      "claim_attachment:delete",
      operationKey,
      { uploadId },
      async () => {
        if (!removeClaimUpload(uploadId)) throw new NotFoundException("attachment_not_found");
        return { success: true };
      },
    );
  }
}
