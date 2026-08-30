import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, NotFoundException, Post, Query, Res, ServiceUnavailableException, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { getClaimUpload, removeClaimUpload, storeClaimUpload } from "../../../../src/claims/attachment-store.ts";
import type { ClaimAttachmentCategory } from "../../../../src/claims/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { AttachmentOcrService } from "./attachment-ocr.service.ts";
import { Roles } from "../auth/auth.decorators.ts";

const categories: ClaimAttachmentCategory[] = ["application", "identity", "medical", "invoice", "bank", "other"];

@Controller("claim-attachments")
export class AttachmentsController {
  constructor(
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AttachmentOcrService) private readonly ocr: AttachmentOcrService,
  ) {}

  @Get("ocr")
  @Roles("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer")
  async ocrResult(@Query("uploadId") uploadId?: string) {
    if (!uploadId) throw new BadRequestException("uploadId is required");
    const result = await this.ocr.get(uploadId);
    if (!result) throw new NotFoundException("attachment_ocr_not_found");
    return result;
  }

  @Post("ocr/retry")
  @Roles("claim_acceptor", "claim_calculator")
  async retryOcr(@Body("uploadId") uploadId?: string) {
    if (!uploadId) throw new BadRequestException("uploadId is required");
    if (!getClaimUpload(uploadId)) throw new NotFoundException("attachment_not_found");
    return this.ocr.retry(uploadId);
  }

  @Get()
  @Roles("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer")
  preview(
    @Query("uploadId") uploadId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!uploadId) throw new BadRequestException("uploadId is required");
    const stored = getClaimUpload(uploadId);
    if (!stored) throw new NotFoundException("attachment_not_found");
    response.set({
      "Content-Type": stored.upload.mimeType,
      "Content-Length": stored.data.byteLength,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(stored.upload.fileName)}`,
      "Cache-Control": "private, max-age=300",
    });
    return new StreamableFile(Buffer.from(stored.data));
  }

  @Post()
  @Roles("claim_acceptor", "claim_calculator")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("category") category?: string,
  ) {
    if (!file || !categories.includes(category as ClaimAttachmentCategory)) {
      throw new BadRequestException("invalid_attachment");
    }
    let upload;
    try {
      upload = storeClaimUpload({
        fileName: file.originalname,
        mimeType: file.mimetype,
        data: new Uint8Array(file.buffer),
        category: category as ClaimAttachmentCategory,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "attachment_upload_failed");
    }
    try {
      return { ...upload, ocr: await this.ocr.enqueue(upload.uploadId) };
    } catch {
      removeClaimUpload(upload.uploadId);
      throw new ServiceUnavailableException("attachment_ocr_enqueue_failed");
    }
  }

  @Delete()
  @Roles("claim_acceptor", "claim_calculator")
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
        await this.ocr.remove(uploadId);
        removeClaimUpload(uploadId);
        return { success: true };
      },
    );
  }
}
