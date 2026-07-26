DROP TABLE IF EXISTS "calculation_variable_definition";
DROP TABLE IF EXISTS "benefit_calculation_formula";

CREATE TABLE "calculation_variable_definition" (
  "id" SERIAL NOT NULL,
  "policy_id" VARCHAR(50) NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "variable_name" VARCHAR(100) NOT NULL,
  "value_type" VARCHAR(30) NOT NULL,
  "unit" VARCHAR(30),
  "default_value" TEXT,
  "description" TEXT,
  "custom" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calculation_variable_definition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uk_calc_variable_policy_name" ON "calculation_variable_definition"("policy_id", "variable_name");
CREATE INDEX "idx_calc_variable_policy_category" ON "calculation_variable_definition"("policy_id", "category");

CREATE TABLE "benefit_calculation_formula" (
  "id" SERIAL NOT NULL,
  "policy_id" VARCHAR(50) NOT NULL,
  "benefit_id" VARCHAR(50) NOT NULL,
  "formula_name" VARCHAR(150) NOT NULL,
  "match_expression" TEXT,
  "steps" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "benefit_calculation_formula_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "benefit_calculation_formula_benefit_id_key" ON "benefit_calculation_formula"("benefit_id");
CREATE INDEX "idx_benefit_formula_policy" ON "benefit_calculation_formula"("policy_id");

INSERT INTO "benefit_calculation_formula" (
  "policy_id", "benefit_id", "formula_name", "match_expression", "steps", "enabled", "created_at", "updated_at"
)
SELECT
  product.policy_id,
  benefit.id,
  benefit.benefit_name || '自动理算公式',
  NULL,
  '[
    {"id":"1","name":"可理算费用","expression":"最大(0, 医疗总费用 - 自费金额)","result":false},
    {"id":"2","name":"本次免赔额","expression":"最小(可理算费用, 最大(0, 免赔额 - 年度已使用免赔额))","result":false,"ledgerTarget":{"code":"deductible_used","name":"年度累计免赔额"}},
    {"id":"3","name":"扣除免赔后金额","expression":"最大(0, 可理算费用 - 本次免赔额)","result":false},
    {"id":"4","name":"比例给付金额","expression":"扣除免赔后金额 * 如果(赔付比例 大于 0, 赔付比例 / 100, 1)","result":false},
    {"id":"5","name":"责任给付金额","expression":"最小(比例给付金额, 如果(单次赔付限额 大于 0, 单次赔付限额, 比例给付金额), 如果(年度累计赔付限额 大于 0, 最大(0, 年度累计赔付限额 - 年度累计给付金额), 比例给付金额))","result":true,"ledgerTarget":{"code":"annual_payment","name":"年度累计给付金额"}},
    {"id":"6","name":"本次使用限额","expression":"责任给付金额","result":false,"ledgerTarget":{"code":"limit_used","name":"年度累计使用限额"}}
  ]'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "policy_benefit" benefit
JOIN "policy_product" product ON product.id = benefit.policy_product_id
WHERE benefit.benefit_status = 'active'
  AND benefit.claimable_flag = true;
