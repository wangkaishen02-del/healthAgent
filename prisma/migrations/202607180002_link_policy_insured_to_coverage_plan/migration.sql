ALTER TABLE "policy_insured" ADD COLUMN "coverage_plan_id" UUID;

CREATE INDEX "idx_policy_insured_coverage_plan_id" ON "policy_insured"("coverage_plan_id");
