-- 将账单固定业务数据由 JSON 拆分为独立字段。
-- 将可扩展参数、适用责任和影像关联改为竖表，保留现有账单数据。

BEGIN;

ALTER TABLE "claim_bill"
  ADD COLUMN "invoice_code" VARCHAR(50),
  ADD COLUMN "invoice_no" VARCHAR(100),
  ADD COLUMN "check_code" VARCHAR(100),
  ADD COLUMN "bill_type" VARCHAR(50),
  ADD COLUMN "patient_name" VARCHAR(100),
  ADD COLUMN "patient_id_no" VARCHAR(50),
  ADD COLUMN "visit_no" VARCHAR(100),
  ADD COLUMN "institution" VARCHAR(200),
  ADD COLUMN "department" VARCHAR(100),
  ADD COLUMN "bill_date" DATE,
  ADD COLUMN "admission_date" DATE,
  ADD COLUMN "discharge_date" DATE,
  ADD COLUMN "diagnosis" TEXT,
  ADD COLUMN "medical_insurance_type" VARCHAR(50),
  ADD COLUMN "settlement_no" VARCHAR(100),
  ADD COLUMN "total_amount" DECIMAL(18,2),
  ADD COLUMN "insurance_fund_amount" DECIMAL(18,2),
  ADD COLUMN "personal_account_amount" DECIMAL(18,2),
  ADD COLUMN "cash_amount" DECIMAL(18,2),
  ADD COLUMN "self_paid_amount" DECIMAL(18,2),
  ADD COLUMN "cashier" VARCHAR(100);

CREATE TABLE "claim_bill_custom_value" (
  "id" SERIAL NOT NULL,
  "bill_id" VARCHAR(50) NOT NULL,
  "variable_definition_id" INTEGER,
  "variable_name" VARCHAR(100) NOT NULL,
  "value_type" VARCHAR(30) NOT NULL,
  "value_text" TEXT,
  "value_number" DECIMAL(18,4),
  "value_boolean" BOOLEAN,
  "value_date" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_bill_custom_value_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_claim_bill_custom_value"
  ON "claim_bill_custom_value"("bill_id", "variable_name");
CREATE INDEX "idx_claim_bill_custom_value_bill"
  ON "claim_bill_custom_value"("bill_id");
CREATE INDEX "idx_claim_bill_custom_value_definition"
  ON "claim_bill_custom_value"("variable_definition_id");

CREATE TABLE "claim_bill_benefit" (
  "id" SERIAL NOT NULL,
  "bill_id" VARCHAR(50) NOT NULL,
  "benefit_id" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_bill_benefit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_claim_bill_benefit"
  ON "claim_bill_benefit"("bill_id", "benefit_id");
CREATE INDEX "idx_claim_bill_benefit_bill"
  ON "claim_bill_benefit"("bill_id");
CREATE INDEX "idx_claim_bill_benefit_benefit"
  ON "claim_bill_benefit"("benefit_id");

CREATE TABLE "claim_bill_attachment" (
  "id" SERIAL NOT NULL,
  "bill_id" VARCHAR(50) NOT NULL,
  "upload_id" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_bill_attachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_claim_bill_attachment"
  ON "claim_bill_attachment"("bill_id", "upload_id");
CREATE INDEX "idx_claim_bill_attachment_bill"
  ON "claim_bill_attachment"("bill_id");
CREATE INDEX "idx_claim_bill_attachment_upload"
  ON "claim_bill_attachment"("upload_id");

UPDATE "claim_bill"
SET
  "invoice_code" = COALESCE("bill_data"->>'invoiceCode', ''),
  "invoice_no" = COALESCE("bill_data"->>'invoiceNo', ''),
  "check_code" = COALESCE("bill_data"->>'checkCode', ''),
  "bill_type" = COALESCE("bill_data"->>'billType', ''),
  "patient_name" = COALESCE("bill_data"->>'patientName', ''),
  "patient_id_no" = COALESCE("bill_data"->>'patientIdNo', ''),
  "visit_no" = COALESCE("bill_data"->>'visitNo', ''),
  "institution" = COALESCE("bill_data"->>'institution', ''),
  "department" = COALESCE("bill_data"->>'department', ''),
  "bill_date" = CASE
    WHEN COALESCE("bill_data"->>'billDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN ("bill_data"->>'billDate')::DATE
    ELSE "created_at"::DATE
  END,
  "admission_date" = CASE
    WHEN COALESCE("bill_data"->>'admissionDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN ("bill_data"->>'admissionDate')::DATE
    ELSE NULL
  END,
  "discharge_date" = CASE
    WHEN COALESCE("bill_data"->>'dischargeDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN ("bill_data"->>'dischargeDate')::DATE
    ELSE NULL
  END,
  "diagnosis" = COALESCE("bill_data"->>'diagnosis', ''),
  "medical_insurance_type" = COALESCE("bill_data"->>'medicalInsuranceType', ''),
  "settlement_no" = COALESCE("bill_data"->>'settlementNo', ''),
  "total_amount" = CASE
    WHEN COALESCE("bill_data"->>'totalAmount', '') ~ '^-?\d+(\.\d+)?$'
      THEN ("bill_data"->>'totalAmount')::DECIMAL(18,2)
    ELSE 0
  END,
  "insurance_fund_amount" = CASE
    WHEN COALESCE("bill_data"->>'insuranceFundAmount', '') ~ '^-?\d+(\.\d+)?$'
      THEN ("bill_data"->>'insuranceFundAmount')::DECIMAL(18,2)
    ELSE 0
  END,
  "personal_account_amount" = CASE
    WHEN COALESCE("bill_data"->>'personalAccountAmount', '') ~ '^-?\d+(\.\d+)?$'
      THEN ("bill_data"->>'personalAccountAmount')::DECIMAL(18,2)
    ELSE 0
  END,
  "cash_amount" = CASE
    WHEN COALESCE("bill_data"->>'cashAmount', '') ~ '^-?\d+(\.\d+)?$'
      THEN ("bill_data"->>'cashAmount')::DECIMAL(18,2)
    ELSE 0
  END,
  "self_paid_amount" = CASE
    WHEN COALESCE("bill_data"->>'selfPaidAmount', '') ~ '^-?\d+(\.\d+)?$'
      THEN ("bill_data"->>'selfPaidAmount')::DECIMAL(18,2)
    ELSE 0
  END,
  "cashier" = COALESCE("bill_data"->>'cashier', '');

INSERT INTO "claim_bill_custom_value" (
  "bill_id",
  "variable_definition_id",
  "variable_name",
  "value_type",
  "value_text",
  "value_number",
  "value_boolean",
  "value_date",
  "created_at",
  "updated_at"
)
SELECT
  cb."id",
  cvd."id",
  item."key",
  COALESCE(
    cvd."value_type",
    CASE jsonb_typeof(item."value")
      WHEN 'number' THEN 'number'
      WHEN 'boolean' THEN 'boolean'
      ELSE 'text'
    END
  ),
  CASE
    WHEN COALESCE(cvd."value_type", '') NOT IN ('number', 'amount', 'percentage', 'boolean', 'date')
      THEN item."value" #>> '{}'
    WHEN cvd."id" IS NULL AND jsonb_typeof(item."value") = 'string'
      THEN item."value" #>> '{}'
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(cvd."value_type", '') IN ('number', 'amount', 'percentage')
      AND (item."value" #>> '{}') ~ '^-?\d+(\.\d+)?$'
      THEN (item."value" #>> '{}')::DECIMAL(18,4)
    WHEN cvd."id" IS NULL
      AND jsonb_typeof(item."value") = 'number'
      THEN (item."value" #>> '{}')::DECIMAL(18,4)
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(cvd."value_type", '') = 'boolean'
      OR (cvd."id" IS NULL AND jsonb_typeof(item."value") = 'boolean')
      THEN (item."value" #>> '{}')::BOOLEAN
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(cvd."value_type", '') = 'date'
      AND (item."value" #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (item."value" #>> '{}')::DATE
    ELSE NULL
  END,
  cb."created_at",
  cb."updated_at"
FROM "claim_bill" cb
JOIN "claim_case" cc ON cc."id" = cb."claim_case_id"
CROSS JOIN LATERAL jsonb_each(COALESCE(cb."custom_values", '{}'::jsonb)) item
LEFT JOIN "calculation_variable_definition" cvd
  ON cvd."policy_id" = cc."policy_id"
 AND cvd."variable_name" = item."key";

INSERT INTO "claim_bill_benefit" ("bill_id", "benefit_id", "created_at")
SELECT cb."id", selected."benefit_id", cb."created_at"
FROM "claim_bill" cb
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(cb."selected_benefit_ids") = 'array'
      THEN cb."selected_benefit_ids"
    ELSE '[]'::jsonb
  END
) selected("benefit_id")
ON CONFLICT ("bill_id", "benefit_id") DO NOTHING;

INSERT INTO "claim_bill_attachment" ("bill_id", "upload_id", "created_at")
SELECT cb."id", attachment."upload_id", cb."created_at"
FROM "claim_bill" cb
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(cb."bill_data"->'attachmentIds') = 'array'
      THEN cb."bill_data"->'attachmentIds'
    ELSE '[]'::jsonb
  END
) attachment("upload_id")
ON CONFLICT ("bill_id", "upload_id") DO NOTHING;

ALTER TABLE "claim_bill"
  ALTER COLUMN "invoice_code" SET DEFAULT '',
  ALTER COLUMN "invoice_code" SET NOT NULL,
  ALTER COLUMN "invoice_no" SET DEFAULT '',
  ALTER COLUMN "invoice_no" SET NOT NULL,
  ALTER COLUMN "check_code" SET DEFAULT '',
  ALTER COLUMN "check_code" SET NOT NULL,
  ALTER COLUMN "bill_type" SET DEFAULT '',
  ALTER COLUMN "bill_type" SET NOT NULL,
  ALTER COLUMN "patient_name" SET DEFAULT '',
  ALTER COLUMN "patient_name" SET NOT NULL,
  ALTER COLUMN "patient_id_no" SET DEFAULT '',
  ALTER COLUMN "patient_id_no" SET NOT NULL,
  ALTER COLUMN "visit_no" SET DEFAULT '',
  ALTER COLUMN "visit_no" SET NOT NULL,
  ALTER COLUMN "institution" SET DEFAULT '',
  ALTER COLUMN "institution" SET NOT NULL,
  ALTER COLUMN "department" SET DEFAULT '',
  ALTER COLUMN "department" SET NOT NULL,
  ALTER COLUMN "bill_date" SET NOT NULL,
  ALTER COLUMN "diagnosis" SET DEFAULT '',
  ALTER COLUMN "diagnosis" SET NOT NULL,
  ALTER COLUMN "medical_insurance_type" SET DEFAULT '',
  ALTER COLUMN "medical_insurance_type" SET NOT NULL,
  ALTER COLUMN "settlement_no" SET DEFAULT '',
  ALTER COLUMN "settlement_no" SET NOT NULL,
  ALTER COLUMN "total_amount" SET DEFAULT 0,
  ALTER COLUMN "total_amount" SET NOT NULL,
  ALTER COLUMN "insurance_fund_amount" SET DEFAULT 0,
  ALTER COLUMN "insurance_fund_amount" SET NOT NULL,
  ALTER COLUMN "personal_account_amount" SET DEFAULT 0,
  ALTER COLUMN "personal_account_amount" SET NOT NULL,
  ALTER COLUMN "cash_amount" SET DEFAULT 0,
  ALTER COLUMN "cash_amount" SET NOT NULL,
  ALTER COLUMN "self_paid_amount" SET DEFAULT 0,
  ALTER COLUMN "self_paid_amount" SET NOT NULL,
  ALTER COLUMN "cashier" SET DEFAULT '',
  ALTER COLUMN "cashier" SET NOT NULL,
  DROP COLUMN "bill_data",
  DROP COLUMN "custom_values",
  DROP COLUMN "selected_benefit_ids";

CREATE INDEX "idx_claim_bill_invoice_no" ON "claim_bill"("invoice_no");

COMMENT ON TABLE "claim_bill" IS '理赔医疗账单主表';
COMMENT ON COLUMN "claim_bill"."id" IS '账单主键标识';
COMMENT ON COLUMN "claim_bill"."claim_case_id" IS '所属理赔案件标识';
COMMENT ON COLUMN "claim_bill"."invoice_code" IS '医疗票据代码';
COMMENT ON COLUMN "claim_bill"."invoice_no" IS '医疗票据号码';
COMMENT ON COLUMN "claim_bill"."check_code" IS '医疗票据校验码';
COMMENT ON COLUMN "claim_bill"."bill_type" IS '账单类型';
COMMENT ON COLUMN "claim_bill"."patient_name" IS '患者姓名';
COMMENT ON COLUMN "claim_bill"."patient_id_no" IS '患者证件号码';
COMMENT ON COLUMN "claim_bill"."visit_no" IS '门诊号或住院号';
COMMENT ON COLUMN "claim_bill"."institution" IS '医疗机构名称';
COMMENT ON COLUMN "claim_bill"."department" IS '就诊科室';
COMMENT ON COLUMN "claim_bill"."bill_date" IS '票据开具日期';
COMMENT ON COLUMN "claim_bill"."admission_date" IS '入院日期';
COMMENT ON COLUMN "claim_bill"."discharge_date" IS '出院日期';
COMMENT ON COLUMN "claim_bill"."diagnosis" IS '诊断信息';
COMMENT ON COLUMN "claim_bill"."medical_insurance_type" IS '医疗保险类型';
COMMENT ON COLUMN "claim_bill"."settlement_no" IS '医保结算单号';
COMMENT ON COLUMN "claim_bill"."total_amount" IS '医疗费用总金额';
COMMENT ON COLUMN "claim_bill"."insurance_fund_amount" IS '医保统筹基金支付金额';
COMMENT ON COLUMN "claim_bill"."personal_account_amount" IS '医保个人账户支付金额';
COMMENT ON COLUMN "claim_bill"."cash_amount" IS '个人现金支付金额';
COMMENT ON COLUMN "claim_bill"."self_paid_amount" IS '自费金额';
COMMENT ON COLUMN "claim_bill"."cashier" IS '收款员或收费员';
COMMENT ON COLUMN "claim_bill"."created_at" IS '创建时间';
COMMENT ON COLUMN "claim_bill"."updated_at" IS '更新时间';

COMMENT ON TABLE "claim_bill_custom_value" IS '理赔账单自定义参数值竖表';
COMMENT ON COLUMN "claim_bill_custom_value"."id" IS '账单自定义参数值自增主键';
COMMENT ON COLUMN "claim_bill_custom_value"."bill_id" IS '所属账单标识';
COMMENT ON COLUMN "claim_bill_custom_value"."variable_definition_id" IS '自定义参数定义标识，定义删除后仍可通过名称快照识别';
COMMENT ON COLUMN "claim_bill_custom_value"."variable_name" IS '参数名称快照';
COMMENT ON COLUMN "claim_bill_custom_value"."value_type" IS '参数值类型';
COMMENT ON COLUMN "claim_bill_custom_value"."value_text" IS '文本类型参数值';
COMMENT ON COLUMN "claim_bill_custom_value"."value_number" IS '数值类型参数值';
COMMENT ON COLUMN "claim_bill_custom_value"."value_boolean" IS '是否类型参数值';
COMMENT ON COLUMN "claim_bill_custom_value"."value_date" IS '日期类型参数值';
COMMENT ON COLUMN "claim_bill_custom_value"."created_at" IS '创建时间';
COMMENT ON COLUMN "claim_bill_custom_value"."updated_at" IS '更新时间';

COMMENT ON TABLE "claim_bill_benefit" IS '理赔账单适用责任关联竖表';
COMMENT ON COLUMN "claim_bill_benefit"."id" IS '账单适用责任关联自增主键';
COMMENT ON COLUMN "claim_bill_benefit"."bill_id" IS '账单标识';
COMMENT ON COLUMN "claim_bill_benefit"."benefit_id" IS '责任标识';
COMMENT ON COLUMN "claim_bill_benefit"."created_at" IS '创建时间';

COMMENT ON TABLE "claim_bill_attachment" IS '理赔账单影像关联竖表';
COMMENT ON COLUMN "claim_bill_attachment"."id" IS '账单影像关联自增主键';
COMMENT ON COLUMN "claim_bill_attachment"."bill_id" IS '账单标识';
COMMENT ON COLUMN "claim_bill_attachment"."upload_id" IS '影像上传标识';
COMMENT ON COLUMN "claim_bill_attachment"."created_at" IS '创建时间';

COMMIT;
