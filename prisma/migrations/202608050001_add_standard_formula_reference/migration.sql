CREATE SEQUENCE "standard_formula_code_seq" START 1;

CREATE TABLE "standard_calculation_formula" (
  "id" SERIAL NOT NULL,
  "formula_code" VARCHAR(20) NOT NULL DEFAULT ('SF' || LPAD(nextval('standard_formula_code_seq')::TEXT, 8, '0')),
  "formula_name" VARCHAR(150) NOT NULL,
  "match_expression" TEXT NOT NULL,
  "steps" JSONB NOT NULL,
  "source_policy_id" VARCHAR(50),
  "source_benefit_id" VARCHAR(50),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "standard_calculation_formula_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "standard_calculation_formula_formula_code_key"
  ON "standard_calculation_formula"("formula_code");
CREATE INDEX "idx_standard_formula_created"
  ON "standard_calculation_formula"("created_at");

ALTER TABLE "benefit_calculation_formula"
  ADD COLUMN "standard_formula_id" INTEGER;
CREATE INDEX "idx_benefit_formula_standard"
  ON "benefit_calculation_formula"("standard_formula_id");
ALTER TABLE "benefit_calculation_formula"
  ADD CONSTRAINT "benefit_calculation_formula_standard_formula_id_fkey"
  FOREIGN KEY ("standard_formula_id") REFERENCES "standard_calculation_formula"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
