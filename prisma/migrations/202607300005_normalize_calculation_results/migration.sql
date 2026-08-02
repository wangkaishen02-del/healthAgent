CREATE TABLE "claim_case_calculation_result" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "run_no" VARCHAR(50) NOT NULL,
  "policy_id" VARCHAR(50) NOT NULL,
  "insured_person_id" VARCHAR(50) NOT NULL,
  "total_amount" DECIMAL(18,2) NOT NULL,
  "bill_count" INTEGER NOT NULL,
  "responsibility_result_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_case_calculation_result_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_case_calculation_result_run_no_key"
  ON "claim_case_calculation_result"("run_no");
CREATE INDEX "idx_case_calc_result_case_created"
  ON "claim_case_calculation_result"("claim_case_id", "created_at");

CREATE TABLE "claim_bill_benefit_calculation_result" (
  "id" VARCHAR(50) NOT NULL,
  "calculation_result_id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "bill_id" VARCHAR(50) NOT NULL,
  "invoice_no" VARCHAR(100) NOT NULL,
  "benefit_id" VARCHAR(50) NOT NULL,
  "benefit_code" VARCHAR(50) NOT NULL,
  "benefit_name" VARCHAR(200) NOT NULL,
  "formula_name" VARCHAR(200) NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "matched" BOOLEAN NOT NULL,
  "match_expression" TEXT NOT NULL,
  "substituted_match_expression" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_bill_benefit_calculation_result_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_bill_benefit_calc_result"
  ON "claim_bill_benefit_calculation_result"("calculation_result_id", "bill_id", "benefit_id");
CREATE INDEX "idx_bill_benefit_calc_case_bill"
  ON "claim_bill_benefit_calculation_result"("claim_case_id", "bill_id");
CREATE INDEX "idx_bill_benefit_calc_result_sequence"
  ON "claim_bill_benefit_calculation_result"("calculation_result_id", "sequence_no");

CREATE TABLE "claim_calculation_process" (
  "id" VARCHAR(50) NOT NULL,
  "bill_benefit_result_id" VARCHAR(50) NOT NULL,
  "step_id" VARCHAR(50) NOT NULL,
  "step_name" VARCHAR(200) NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "expression" TEXT NOT NULL,
  "substituted_expression" TEXT NOT NULL,
  "result_flag" BOOLEAN NOT NULL DEFAULT FALSE,
  "result_value" JSONB NOT NULL,
  "ledger_target_code" VARCHAR(80),
  "ledger_target_name" VARCHAR(100),
  "ledger_opening_amount" DECIMAL(18,2),
  "ledger_closing_amount" DECIMAL(18,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_calculation_process_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_calc_process_result_sequence"
  ON "claim_calculation_process"("bill_benefit_result_id", "sequence_no");

COMMENT ON TABLE "claim_case_calculation_result" IS '案件级理算结果；每次正式理算保存一条案件汇总快照';
COMMENT ON COLUMN "claim_case_calculation_result"."id" IS '案件理算结果主键';
COMMENT ON COLUMN "claim_case_calculation_result"."claim_case_id" IS '案件主键';
COMMENT ON COLUMN "claim_case_calculation_result"."run_no" IS '本次理算运行号';
COMMENT ON COLUMN "claim_case_calculation_result"."policy_id" IS '案件对应保单主键';
COMMENT ON COLUMN "claim_case_calculation_result"."insured_person_id" IS '被保险人主键';
COMMENT ON COLUMN "claim_case_calculation_result"."total_amount" IS '案件本次理算给付总金额';
COMMENT ON COLUMN "claim_case_calculation_result"."bill_count" IS '本次参加理算的账单数量';
COMMENT ON COLUMN "claim_case_calculation_result"."responsibility_result_count" IS '本次生成的账单责任结果数量';
COMMENT ON COLUMN "claim_case_calculation_result"."created_at" IS '理算完成时间';

COMMENT ON TABLE "claim_bill_benefit_calculation_result" IS '账单在指定保障责任下的理算结果';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."id" IS '账单责任理算结果主键';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."calculation_result_id" IS '所属案件理算结果主键';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."claim_case_id" IS '案件主键，便于按案件查询';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."bill_id" IS '账单主键';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."invoice_no" IS '理算时的票据号码快照';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."benefit_id" IS '保障责任主键';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."benefit_code" IS '保障责任代码快照';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."benefit_name" IS '保障责任名称快照';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."formula_name" IS '执行公式名称快照';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."sequence_no" IS '本次理算中的执行顺序';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."matched" IS '自动匹配条件是否通过';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."match_expression" IS '自动匹配条件原始表达式';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."substituted_match_expression" IS '参数替换后的自动匹配条件';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."amount" IS '该账单在该责任下的给付金额';
COMMENT ON COLUMN "claim_bill_benefit_calculation_result"."created_at" IS '结果生成时间';

COMMENT ON TABLE "claim_calculation_process" IS '账单责任理算的逐步公式执行过程';
COMMENT ON COLUMN "claim_calculation_process"."id" IS '理算过程主键';
COMMENT ON COLUMN "claim_calculation_process"."bill_benefit_result_id" IS '所属账单责任理算结果主键';
COMMENT ON COLUMN "claim_calculation_process"."step_id" IS '公式步骤业务主键快照';
COMMENT ON COLUMN "claim_calculation_process"."step_name" IS '公式步骤名称快照';
COMMENT ON COLUMN "claim_calculation_process"."sequence_no" IS '步骤执行顺序';
COMMENT ON COLUMN "claim_calculation_process"."expression" IS '公式步骤原始表达式';
COMMENT ON COLUMN "claim_calculation_process"."substituted_expression" IS '参数替换后的可计算表达式';
COMMENT ON COLUMN "claim_calculation_process"."result_flag" IS '是否为公式最终结果步骤';
COMMENT ON COLUMN "claim_calculation_process"."result_value" IS '步骤计算结果，支持数值、是否及文本';
COMMENT ON COLUMN "claim_calculation_process"."ledger_target_code" IS '本步骤累计的台账代码';
COMMENT ON COLUMN "claim_calculation_process"."ledger_target_name" IS '本步骤累计的台账名称';
COMMENT ON COLUMN "claim_calculation_process"."ledger_opening_amount" IS '执行本步骤前的责任台账金额';
COMMENT ON COLUMN "claim_calculation_process"."ledger_closing_amount" IS '执行本步骤后的责任台账金额';
COMMENT ON COLUMN "claim_calculation_process"."created_at" IS '步骤过程写入时间';
