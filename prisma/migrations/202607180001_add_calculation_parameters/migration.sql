CREATE TYPE "CalculationParameterScope" AS ENUM ('policy', 'plan', 'product', 'benefit');
CREATE TYPE "CalculationParameterValueType" AS ENUM ('text', 'number', 'percentage', 'amount', 'boolean');

CREATE TABLE "coverage_plan" (
  "id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "plan_code" VARCHAR(50) NOT NULL,
  "plan_name" VARCHAR(100) NOT NULL,
  "effective_date" DATE NOT NULL,
  "expiry_date" DATE NOT NULL,
  "status" "ProductStatus" NOT NULL DEFAULT 'active',
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coverage_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_coverage_plan_policy_id_plan_code" ON "coverage_plan"("policy_id", "plan_code");
CREATE INDEX "idx_coverage_plan_policy_id" ON "coverage_plan"("policy_id");
ALTER TABLE "coverage_plan" ADD CONSTRAINT "coverage_plan_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "policy_product" ADD COLUMN "coverage_plan_id" UUID;
CREATE INDEX "idx_policy_product_coverage_plan_id" ON "policy_product"("coverage_plan_id");
ALTER TABLE "policy_product" ADD CONSTRAINT "policy_product_coverage_plan_id_fkey"
  FOREIGN KEY ("coverage_plan_id") REFERENCES "coverage_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "calculation_parameter_definition" (
  "id" UUID NOT NULL,
  "parameter_code" VARCHAR(80) NOT NULL,
  "parameter_name" VARCHAR(100) NOT NULL,
  "value_type" "CalculationParameterValueType" NOT NULL,
  "unit" VARCHAR(30),
  "applicable_scopes" JSONB NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calculation_parameter_definition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calculation_parameter_definition_parameter_code_key"
  ON "calculation_parameter_definition"("parameter_code");
CREATE UNIQUE INDEX "calculation_parameter_definition_parameter_name_key"
  ON "calculation_parameter_definition"("parameter_name");

CREATE TABLE "calculation_parameter" (
  "id" UUID NOT NULL,
  "scope" "CalculationParameterScope" NOT NULL,
  "target_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "parameter_value" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calculation_parameter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_calculation_parameter_scope_target_definition"
  ON "calculation_parameter"("scope", "target_id", "definition_id");
CREATE INDEX "idx_calculation_parameter_scope_target"
  ON "calculation_parameter"("scope", "target_id");
CREATE INDEX "idx_calculation_parameter_definition_id"
  ON "calculation_parameter"("definition_id");
ALTER TABLE "calculation_parameter" ADD CONSTRAINT "calculation_parameter_definition_id_fkey"
  FOREIGN KEY ("definition_id") REFERENCES "calculation_parameter_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
