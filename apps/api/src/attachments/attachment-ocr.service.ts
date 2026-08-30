import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ClaimAttachmentOcr, ClaimAttachmentCategory, Prisma } from "@prisma/client";
import { getClaimUpload } from "../../../../src/claims/attachment-store.ts";
import type { ClaimOcrResult } from "../../../../src/claims/types.ts";
import { PrismaLifecycleService } from "../prisma/prisma-lifecycle.service.ts";

type OcrApiResponse = {
  documentType: string;
  classificationConfidence: number;
  text: string;
  lines: unknown[];
  structured: unknown;
  meta: {
    engine: string;
    elapsedMs: number;
    lineCount: number;
    pageCount: number;
  };
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

@Injectable()
export class AttachmentOcrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentOcrService.name);
  private readonly ocrUrl = (process.env.OCR_URL ?? "http://127.0.0.1:18080").replace(/\/$/, "");
  private readonly pollMs = Math.max(250, Number(process.env.OCR_POLL_INTERVAL_MS ?? 1000));
  private readonly timeoutMs = Math.max(5000, Number(process.env.OCR_TIMEOUT_MS ?? 120000));
  private readonly leaseMs = Math.max(this.timeoutMs + 30000, Number(process.env.OCR_JOB_LEASE_MS ?? 180000));
  private readonly maxAttempts = Math.max(1, Number(process.env.OCR_MAX_ATTEMPTS ?? 3));
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(PrismaLifecycleService) private readonly prismaService: PrismaLifecycleService) {}

  private get prisma() {
    return this.prismaService.client;
  }

  async onModuleInit() {
    const attachments = await this.prisma.claimAttachment.findMany({ select: { uploadId: true } });
    if (attachments.length) {
      await this.prisma.claimAttachmentOcr.createMany({
        data: attachments.map(({ uploadId }) => ({ uploadId })),
        skipDuplicates: true,
      });
    }
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(uploadId: string) {
    const job = await this.prisma.claimAttachmentOcr.upsert({
      where: { uploadId },
      create: { uploadId },
      update: {},
    });
    void this.tick();
    return this.serialize(job);
  }

  async get(uploadId: string) {
    const job = await this.prisma.claimAttachmentOcr.findUnique({ where: { uploadId } });
    return job ? this.serialize(job) : undefined;
  }

  async retry(uploadId: string) {
    const existing = await this.prisma.claimAttachmentOcr.findUnique({ where: { uploadId } });
    if (existing && !TERMINAL_STATUSES.has(existing.status)) return this.serialize(existing);
    const job = await this.prisma.claimAttachmentOcr.upsert({
      where: { uploadId },
      create: { uploadId },
      update: {
        status: "queued",
        attempts: 0,
        lastError: null,
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        nextAttemptAt: new Date(),
      },
    });
    void this.tick();
    return this.serialize(job);
  }

  async remove(uploadId: string) {
    await this.prisma.claimAttachmentOcr.deleteMany({ where: { uploadId } });
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      while (await this.processNext()) {
        // 持续清空当前队列，单个 API 进程内按顺序识别，避免 OCR 模型并发抢占内存。
      }
    } catch (error) {
      this.logger.error("OCR queue polling failed", error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  private async processNext() {
    const now = new Date();
    const candidate = await this.prisma.claimAttachmentOcr.findFirst({
      where: {
        nextAttemptAt: { lte: now },
        status: { in: ["queued", "processing"] },
      },
      orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return false;

    const startedAt = new Date();
    const claimed = await this.prisma.claimAttachmentOcr.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        nextAttemptAt: { lte: now },
      },
      data: {
        status: "processing",
        startedAt,
        completedAt: null,
        lastError: null,
        attempts: { increment: 1 },
        nextAttemptAt: new Date(startedAt.getTime() + this.leaseMs),
      },
    });
    if (!claimed.count) return true;

    const attempt = candidate.attempts + 1;
    try {
      const result = await this.recognize(candidate.uploadId);
      await this.prisma.claimAttachmentOcr.update({
        where: { id: candidate.id },
        data: {
          status: "succeeded",
          documentType: result.documentType,
          classificationConfidence: result.classificationConfidence,
          rawText: result.text,
          lines: result.lines as Prisma.InputJsonValue,
          structuredData: result.structured as Prisma.InputJsonValue,
          engine: result.meta.engine,
          durationMs: Math.round(result.meta.elapsedMs),
          pageCount: result.meta.pageCount,
          lastError: null,
          completedAt: new Date(),
          nextAttemptAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = attempt < this.maxAttempts;
      try {
        await this.prisma.claimAttachmentOcr.update({
          where: { id: candidate.id },
          data: {
            status: retry ? "queued" : "failed",
            lastError: message.slice(0, 4000),
            completedAt: retry ? null : new Date(),
            nextAttemptAt: retry
              ? new Date(Date.now() + Math.min(60000, 2000 * 2 ** (attempt - 1)))
              : new Date(),
          },
        });
      } catch (updateError) {
        this.logger.warn(`OCR job ${candidate.uploadId} was removed while processing`);
        return true;
      }
      this.logger.warn(`OCR job ${candidate.uploadId} attempt ${attempt} failed: ${message}`);
    }
    return true;
  }

  private async recognize(uploadId: string): Promise<OcrApiResponse> {
    const stored = getClaimUpload(uploadId);
    if (!stored) throw new Error("attachment_file_not_found");

    const documentType = this.documentTypeFor(stored.upload.category);
    const form = new FormData();
    const bytes = Uint8Array.from(stored.data);
    form.append("file", new Blob([bytes.buffer], { type: stored.upload.mimeType }), stored.upload.fileName);
    form.append("document_type", documentType);

    const response = await fetch(`${this.ocrUrl}/v1/ocr`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`ocr_http_${response.status}:${detail}`);
    }

    const result = await response.json() as Partial<OcrApiResponse>;
    if (
      typeof result.documentType !== "string"
      || typeof result.text !== "string"
      || !Array.isArray(result.lines)
      || !result.meta
      || typeof result.meta.engine !== "string"
    ) {
      throw new Error("invalid_ocr_response");
    }
    return result as OcrApiResponse;
  }

  private documentTypeFor(category: ClaimAttachmentCategory) {
    if (category === "identity") return "id_card";
    if (category === "invoice") return "medical_invoice";
    return "auto";
  }

  private serialize(job: ClaimAttachmentOcr): ClaimOcrResult {
    return {
      status: job.status,
      documentType: job.documentType ?? undefined,
      classificationConfidence: job.classificationConfidence ?? undefined,
      text: job.rawText ?? undefined,
      lines: job.lines ? job.lines as unknown as ClaimOcrResult["lines"] : undefined,
      structuredData: job.structuredData ?? undefined,
      engine: job.engine ?? undefined,
      durationMs: job.durationMs ?? undefined,
      pageCount: job.pageCount ?? undefined,
      attempts: job.attempts,
      lastError: job.lastError ?? undefined,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
