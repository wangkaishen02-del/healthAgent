CREATE TABLE "calculation_variable_definition" (
  "id" VARCHAR(50) NOT NULL,
  "policy_id" VARCHAR(50) NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "variable_code" VARCHAR(100) NOT NULL,
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
CREATE UNIQUE INDEX "uk_calc_variable_policy_code" ON "calculation_variable_definition"("policy_id", "variable_code");
CREATE INDEX "idx_calc_variable_policy_category" ON "calculation_variable_definition"("policy_id", "category");

CREATE TABLE "benefit_calculation_formula" (
  "id" VARCHAR(50) NOT NULL,
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

CREATE TABLE "claim_bill" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "bill_data" JSONB NOT NULL,
  "custom_values" JSONB NOT NULL,
  "selected_benefit_ids" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_bill_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_claim_bill_case" ON "claim_bill"("claim_case_id");

CREATE TABLE "claim_calculation_run" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "run_no" VARCHAR(50) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "total_amount" DECIMAL(18,2) NOT NULL,
  "result_data" JSONB NOT NULL,
  "committed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_calculation_run_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "claim_calculation_run_run_no_key" ON "claim_calculation_run"("run_no");
CREATE INDEX "idx_calc_run_case_created" ON "claim_calculation_run"("claim_case_id", "created_at");

CREATE TABLE "claim_ledger_balance" (
  "id" VARCHAR(50) NOT NULL,
  "policy_id" VARCHAR(50) NOT NULL,
  "insured_person_id" VARCHAR(50) NOT NULL,
  "benefit_id" VARCHAR(50) NOT NULL,
  "ledger_code" VARCHAR(80) NOT NULL,
  "ledger_name" VARCHAR(100) NOT NULL,
  "period_year" INTEGER NOT NULL,
  "used_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_ledger_balance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uk_claim_ledger_balance" ON "claim_ledger_balance"("policy_id", "insured_person_id", "benefit_id", "ledger_code", "period_year");
CREATE INDEX "idx_claim_ledger_person_year" ON "claim_ledger_balance"("insured_person_id", "period_year");

CREATE TABLE "claim_ledger_entry" (
  "id" VARCHAR(50) NOT NULL,
  "calculation_run_id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "bill_id" VARCHAR(50),
  "policy_id" VARCHAR(50) NOT NULL,
  "insured_person_id" VARCHAR(50) NOT NULL,
  "benefit_id" VARCHAR(50) NOT NULL,
  "ledger_code" VARCHAR(80) NOT NULL,
  "ledger_name" VARCHAR(100) NOT NULL,
  "period_year" INTEGER NOT NULL,
  "opening_amount" DECIMAL(18,2) NOT NULL,
  "change_amount" DECIMAL(18,2) NOT NULL,
  "closing_amount" DECIMAL(18,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_ledger_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_claim_ledger_entry_case" ON "claim_ledger_entry"("claim_case_id");
CREATE INDEX "idx_claim_ledger_entry_person_benefit" ON "claim_ledger_entry"("insured_person_id", "benefit_id", "period_year");
