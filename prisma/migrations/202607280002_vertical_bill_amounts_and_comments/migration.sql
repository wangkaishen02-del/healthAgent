-- 除医疗费用总额外，其他账单金额改为可扩展竖表。
-- 补齐自动理算幂等记录、台账余额和台账流水的数据字典注释。

BEGIN;

CREATE TABLE "claim_bill_amount" (
  "id" SERIAL NOT NULL,
  "bill_id" VARCHAR(50) NOT NULL,
  "amount_name" VARCHAR(100) NOT NULL,
  "amount_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_bill_amount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_claim_bill_amount"
  ON "claim_bill_amount"("bill_id", "amount_name");
CREATE INDEX "idx_claim_bill_amount_bill"
  ON "claim_bill_amount"("bill_id");

INSERT INTO "claim_bill_amount" (
  "bill_id",
  "amount_name",
  "amount_value",
  "created_at",
  "updated_at"
)
SELECT
  cb."id",
  amount_item."amount_name",
  amount_item."amount_value",
  cb."created_at",
  cb."updated_at"
FROM "claim_bill" cb
CROSS JOIN LATERAL (
  VALUES
    ('医保统筹支付', cb."insurance_fund_amount"),
    ('个人账户支付', cb."personal_account_amount"),
    ('个人现金支付', cb."cash_amount"),
    ('自费金额', cb."self_paid_amount")
) amount_item("amount_name", "amount_value");

ALTER TABLE "claim_bill"
  DROP COLUMN "insurance_fund_amount",
  DROP COLUMN "personal_account_amount",
  DROP COLUMN "cash_amount",
  DROP COLUMN "self_paid_amount";

COMMENT ON TABLE "claim_bill_amount" IS '理赔账单金额明细竖表';
COMMENT ON COLUMN "claim_bill_amount"."id" IS '账单金额明细自增主键';
COMMENT ON COLUMN "claim_bill_amount"."bill_id" IS '所属账单标识';
COMMENT ON COLUMN "claim_bill_amount"."amount_name" IS '金额项目名称';
COMMENT ON COLUMN "claim_bill_amount"."amount_value" IS '金额项目数值';
COMMENT ON COLUMN "claim_bill_amount"."created_at" IS '创建时间';
COMMENT ON COLUMN "claim_bill_amount"."updated_at" IS '更新时间';

COMMENT ON TABLE "idempotency_record" IS '接口幂等请求记录表';
COMMENT ON COLUMN "idempotency_record"."id" IS '幂等记录主键标识';
COMMENT ON COLUMN "idempotency_record"."scope" IS '幂等控制业务范围';
COMMENT ON COLUMN "idempotency_record"."operation_key" IS '客户端操作唯一键';
COMMENT ON COLUMN "idempotency_record"."request_hash" IS '请求内容摘要';
COMMENT ON COLUMN "idempotency_record"."status" IS '请求处理状态';
COMMENT ON COLUMN "idempotency_record"."response" IS '已完成请求的响应结果';
COMMENT ON COLUMN "idempotency_record"."created_at" IS '创建时间';
COMMENT ON COLUMN "idempotency_record"."updated_at" IS '更新时间';

COMMENT ON TABLE "claim_ledger_balance" IS '理赔累计台账余额表';
COMMENT ON COLUMN "claim_ledger_balance"."id" IS '台账余额主键标识';
COMMENT ON COLUMN "claim_ledger_balance"."policy_id" IS '所属保单标识';
COMMENT ON COLUMN "claim_ledger_balance"."insured_person_id" IS '被保人标识';
COMMENT ON COLUMN "claim_ledger_balance"."benefit_id" IS '累计范围标识，可表示责任、险种、计划或事件';
COMMENT ON COLUMN "claim_ledger_balance"."ledger_code" IS '台账项目类型';
COMMENT ON COLUMN "claim_ledger_balance"."ledger_name" IS '台账项目名称';
COMMENT ON COLUMN "claim_ledger_balance"."period_year" IS '累计年度';
COMMENT ON COLUMN "claim_ledger_balance"."used_amount" IS '当前累计已使用金额';
COMMENT ON COLUMN "claim_ledger_balance"."updated_at" IS '更新时间';
COMMENT ON COLUMN "claim_ledger_balance"."created_at" IS '创建时间';

COMMENT ON TABLE "claim_ledger_entry" IS '理赔台账变动流水表';
COMMENT ON COLUMN "claim_ledger_entry"."id" IS '台账流水主键标识';
COMMENT ON COLUMN "claim_ledger_entry"."calculation_run_id" IS '产生本流水的理算批次标识';
COMMENT ON COLUMN "claim_ledger_entry"."claim_case_id" IS '所属理赔案件标识';
COMMENT ON COLUMN "claim_ledger_entry"."bill_id" IS '关联账单标识';
COMMENT ON COLUMN "claim_ledger_entry"."policy_id" IS '所属保单标识';
COMMENT ON COLUMN "claim_ledger_entry"."insured_person_id" IS '被保人标识';
COMMENT ON COLUMN "claim_ledger_entry"."benefit_id" IS '累计范围标识，可表示责任、险种、计划或事件';
COMMENT ON COLUMN "claim_ledger_entry"."ledger_code" IS '台账项目类型';
COMMENT ON COLUMN "claim_ledger_entry"."ledger_name" IS '台账项目名称';
COMMENT ON COLUMN "claim_ledger_entry"."period_year" IS '累计年度';
COMMENT ON COLUMN "claim_ledger_entry"."opening_amount" IS '本次变动前累计金额';
COMMENT ON COLUMN "claim_ledger_entry"."change_amount" IS '本次新增使用金额';
COMMENT ON COLUMN "claim_ledger_entry"."closing_amount" IS '本次变动后累计金额';
COMMENT ON COLUMN "claim_ledger_entry"."created_at" IS '创建时间';

COMMIT;
