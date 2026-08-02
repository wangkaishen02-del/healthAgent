CREATE TABLE "claim_case_event_entry" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "event_type" VARCHAR(30) NOT NULL,
  "occurred_date" DATE NOT NULL,
  "location" VARCHAR(300),
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_case_event_entry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "claim_case_disease_entry" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "disease_name" VARCHAR(200) NOT NULL,
  "icd_code" VARCHAR(50),
  "diagnosis_date" DATE NOT NULL,
  "hospital" VARCHAR(200) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_case_disease_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_claim_case_event_entry_case_date" ON "claim_case_event_entry"("claim_case_id", "occurred_date");
CREATE INDEX "idx_claim_case_disease_entry_case_date" ON "claim_case_disease_entry"("claim_case_id", "diagnosis_date");

COMMENT ON TABLE "claim_case_event_entry" IS '案件处理阶段录入的事件信息表';
COMMENT ON COLUMN "claim_case_event_entry"."id" IS '案件事件录入主键';
COMMENT ON COLUMN "claim_case_event_entry"."claim_case_id" IS '所属案件主键';
COMMENT ON COLUMN "claim_case_event_entry"."event_type" IS '事件类型字典值';
COMMENT ON COLUMN "claim_case_event_entry"."occurred_date" IS '事件发生日期';
COMMENT ON COLUMN "claim_case_event_entry"."location" IS '事件发生地点';
COMMENT ON COLUMN "claim_case_event_entry"."description" IS '事件发生经过';

COMMENT ON TABLE "claim_case_disease_entry" IS '案件处理阶段录入的疾病信息表';
COMMENT ON COLUMN "claim_case_disease_entry"."id" IS '案件疾病录入主键';
COMMENT ON COLUMN "claim_case_disease_entry"."claim_case_id" IS '所属案件主键';
COMMENT ON COLUMN "claim_case_disease_entry"."disease_name" IS '疾病或诊断名称';
COMMENT ON COLUMN "claim_case_disease_entry"."icd_code" IS 'ICD疾病编码';
COMMENT ON COLUMN "claim_case_disease_entry"."diagnosis_date" IS '确诊日期';
COMMENT ON COLUMN "claim_case_disease_entry"."hospital" IS '确诊医院';
COMMENT ON COLUMN "claim_case_disease_entry"."note" IS '疾病诊断补充说明';
