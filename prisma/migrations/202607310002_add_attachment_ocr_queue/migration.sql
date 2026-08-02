CREATE TYPE "OcrJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

CREATE TABLE "claim_attachment_ocr" (
    "id" VARCHAR(50) NOT NULL,
    "upload_id" VARCHAR(50) NOT NULL,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'queued',
    "document_type" VARCHAR(30),
    "classification_confidence" DOUBLE PRECISION,
    "raw_text" TEXT,
    "lines" JSONB,
    "structured_data" JSONB,
    "engine" VARCHAR(50),
    "duration_ms" INTEGER,
    "page_count" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_attachment_ocr_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_attachment_ocr_upload_id_key"
ON "claim_attachment_ocr"("upload_id");

CREATE INDEX "idx_claim_attachment_ocr_queue"
ON "claim_attachment_ocr"("status", "next_attempt_at", "queued_at");

CREATE INDEX "idx_claim_attachment_ocr_document_type"
ON "claim_attachment_ocr"("document_type");

COMMENT ON TABLE "claim_attachment_ocr" IS '影像 OCR 持久化任务及识别结果';
COMMENT ON COLUMN "claim_attachment_ocr"."upload_id" IS '关联影像上传标识，不建立数据库外键';
COMMENT ON COLUMN "claim_attachment_ocr"."lines" IS '逐行文字、置信度、页码及坐标';
COMMENT ON COLUMN "claim_attachment_ocr"."structured_data" IS '身份证、医疗票据等结构化识别结果';
