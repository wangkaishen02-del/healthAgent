ALTER TABLE "claim_case" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "ClaimCaseStatus" RENAME TO "ClaimCaseStatus_old";
CREATE TYPE "ClaimCaseStatus" AS ENUM ('registered', 'entering', 'calculating', 'reviewing', 'completed', 'cancelled');
ALTER TABLE "claim_case" ALTER COLUMN "status" TYPE "ClaimCaseStatus"
USING (CASE WHEN "status"::text = 'processing' THEN 'entering' ELSE "status"::text END)::"ClaimCaseStatus";
ALTER TABLE "claim_case" ALTER COLUMN "status" SET DEFAULT 'registered'::"ClaimCaseStatus";
DROP TYPE "ClaimCaseStatus_old";

UPDATE "claim_case" AS cc
SET "status" = 'calculating'::"ClaimCaseStatus"
WHERE cc."status" = 'entering'::"ClaimCaseStatus"
  AND EXISTS (
    SELECT 1 FROM "claim_case_calculation_result" AS cr
    WHERE cr."claim_case_id" = cc."id"
  );

UPDATE "claim_case_transition"
SET "from_status" = 'entering'
WHERE "from_status" = 'processing';

UPDATE "claim_case_transition"
SET "to_status" = 'entering'
WHERE "to_status" = 'processing';

INSERT INTO "claim_case_transition" (
  "id", "claim_case_id", "action", "from_status", "to_status",
  "operator_user_id", "operator_name", "description", "occurred_at"
)
SELECT gen_random_uuid()::text, latest."claim_case_id", 'calculate', 'entering', 'calculating',
       'default-user', '默认用户', '历史理算结果迁移', latest."created_at"
FROM (
  SELECT DISTINCT ON ("claim_case_id") "claim_case_id", "created_at"
  FROM "claim_case_calculation_result"
  ORDER BY "claim_case_id", "created_at" DESC
) AS latest
WHERE NOT EXISTS (
  SELECT 1 FROM "claim_case_transition" AS ct
  WHERE ct."claim_case_id" = latest."claim_case_id" AND ct."action" = 'calculate'
);

COMMENT ON COLUMN "claim_case"."status" IS '案件状态：registered受理、entering录入、calculating理算、reviewing审核、completed结案、cancelled撤件';
COMMENT ON COLUMN "claim_case_transition"."action" IS '流转动作：create、submit、calculate、rollback_calculation、submit_review、complete、cancel、legacy_import';
