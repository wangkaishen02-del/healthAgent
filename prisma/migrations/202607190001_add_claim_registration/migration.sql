CREATE TYPE "ClaimCaseStatus" AS ENUM ('registered', 'submitted', 'cancelled');
CREATE TYPE "ClaimPartyRole" AS ENUM ('insured', 'applicant', 'payee');
CREATE TYPE "ClaimEventType" AS ENUM ('disease', 'accident', 'other');
CREATE TYPE "ClaimReportChannel" AS ENUM ('online', 'phone', 'counter', 'other');
CREATE TYPE "ClaimAttachmentCategory" AS ENUM ('application', 'identity', 'medical', 'invoice', 'bank', 'other');

CREATE TABLE "claim_case" (
  "id" UUID NOT NULL,
  "case_no" VARCHAR(50) NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_insured_id" UUID NOT NULL,
  "insured_person_id" UUID NOT NULL,
  "report_date" DATE NOT NULL,
  "report_channel" "ClaimReportChannel" NOT NULL,
  "status" "ClaimCaseStatus" NOT NULL DEFAULT 'registered',
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_case_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_case_case_no_key" ON "claim_case"("case_no");
CREATE INDEX "idx_claim_case_policy_id" ON "claim_case"("policy_id");
CREATE INDEX "idx_claim_case_policy_insured_id" ON "claim_case"("policy_insured_id");
CREATE INDEX "idx_claim_case_insured_person_id" ON "claim_case"("insured_person_id");
CREATE INDEX "idx_claim_case_report_date" ON "claim_case"("report_date");
CREATE INDEX "idx_claim_case_status" ON "claim_case"("status");

CREATE TABLE "claim_party" (
  "id" UUID NOT NULL,
  "claim_case_id" UUID NOT NULL,
  "role" "ClaimPartyRole" NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "gender" "Gender" NOT NULL DEFAULT 'unknown',
  "birth_date" DATE,
  "id_type" "IdType" NOT NULL DEFAULT 'id_card',
  "id_no" VARCHAR(50) NOT NULL,
  "id_valid_from" DATE,
  "id_valid_to" DATE,
  "id_long_term" BOOLEAN NOT NULL DEFAULT false,
  "address" VARCHAR(300),
  "phone" VARCHAR(30) NOT NULL,
  "relation_to_insured" VARCHAR(50),
  "bank_name" VARCHAR(100),
  "bank_account_name" VARCHAR(100),
  "bank_account_no" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_party_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_claim_party_case_role" ON "claim_party"("claim_case_id", "role");
CREATE INDEX "idx_claim_party_case_id" ON "claim_party"("claim_case_id");
CREATE INDEX "idx_claim_party_id_no" ON "claim_party"("id_no");

CREATE TABLE "claim_event" (
  "id" UUID NOT NULL,
  "claim_case_id" UUID NOT NULL,
  "event_type" "ClaimEventType" NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "province" VARCHAR(80),
  "city" VARCHAR(80),
  "address" VARCHAR(300),
  "hospital_name" VARCHAR(150),
  "diagnosis" VARCHAR(300),
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_claim_event_case_id" ON "claim_event"("claim_case_id");
CREATE INDEX "idx_claim_event_occurred_at" ON "claim_event"("occurred_at");

CREATE TABLE "claim_attachment" (
  "id" UUID NOT NULL,
  "claim_case_id" UUID NOT NULL,
  "upload_id" UUID NOT NULL,
  "category" "ClaimAttachmentCategory" NOT NULL,
  "file_name" VARCHAR(200) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "storage_key" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_attachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_attachment_upload_id_key" ON "claim_attachment"("upload_id");
CREATE INDEX "idx_claim_attachment_case_id" ON "claim_attachment"("claim_case_id");
CREATE INDEX "idx_claim_attachment_category" ON "claim_attachment"("category");

-- 不创建数据库外键；关联完整性由应用服务校验，查询依赖以上索引。
