-- 关联完整性由应用服务负责，数据库仅保留关联字段与查询索引。
ALTER TABLE "coverage_plan" DROP CONSTRAINT IF EXISTS "coverage_plan_policy_id_fkey";

ALTER TABLE "policy_product" DROP CONSTRAINT IF EXISTS "policy_product_policy_id_fkey";
ALTER TABLE "policy_product" DROP CONSTRAINT IF EXISTS "policy_product_coverage_plan_id_fkey";

ALTER TABLE "policy_benefit" DROP CONSTRAINT IF EXISTS "policy_benefit_policy_product_id_fkey";

ALTER TABLE "policy_insured" DROP CONSTRAINT IF EXISTS "policy_insured_policy_id_fkey";
ALTER TABLE "policy_insured" DROP CONSTRAINT IF EXISTS "policy_insured_coverage_plan_id_fkey";
ALTER TABLE "policy_insured" DROP CONSTRAINT IF EXISTS "policy_insured_insured_person_id_fkey";

ALTER TABLE "calculation_parameter" DROP CONSTRAINT IF EXISTS "calculation_parameter_definition_id_fkey";
