CREATE TYPE "ClaimPaymentMethod" AS ENUM ('pending', 'bank_transfer', 'cash', 'other');

ALTER TABLE "claim_party" ADD COLUMN "payment_method" "ClaimPaymentMethod";

ALTER TABLE "claim_case" ADD COLUMN "event_id" UUID;
UPDATE "claim_case" AS cc
SET "event_id" = ce."id"
FROM "claim_event" AS ce
WHERE ce."claim_case_id" = cc."id";

ALTER TABLE "claim_event"
  ADD COLUMN "event_no" VARCHAR(50),
  ADD COLUMN "insured_person_id" UUID,
  ADD COLUMN "occurred_date" DATE,
  ADD COLUMN "administrative_area" VARCHAR(200),
  ADD COLUMN "detailed_address" VARCHAR(300);

UPDATE "claim_event" AS ce
SET
  "event_no" = 'EV' || TO_CHAR(ce."occurred_at", 'YYYYMMDD') || SUBSTRING(REPLACE(ce."id"::text, '-', '') FROM 1 FOR 8),
  "insured_person_id" = cc."insured_person_id",
  "occurred_date" = ce."occurred_at"::date,
  "administrative_area" = COALESCE(NULLIF(CONCAT_WS(' / ', ce."province", ce."city"), ''), '待补充'),
  "detailed_address" = ce."address"
FROM "claim_case" AS cc
WHERE cc."id" = ce."claim_case_id";

DROP INDEX "idx_claim_event_case_id";
DROP INDEX "idx_claim_event_occurred_at";

ALTER TABLE "claim_event"
  ALTER COLUMN "event_no" SET NOT NULL,
  ALTER COLUMN "insured_person_id" SET NOT NULL,
  ALTER COLUMN "occurred_date" SET NOT NULL,
  ALTER COLUMN "administrative_area" SET NOT NULL,
  DROP COLUMN "claim_case_id",
  DROP COLUMN "occurred_at",
  DROP COLUMN "province",
  DROP COLUMN "city",
  DROP COLUMN "address";

CREATE UNIQUE INDEX "claim_event_event_no_key" ON "claim_event"("event_no");
CREATE INDEX "idx_claim_event_person_date" ON "claim_event"("insured_person_id", "occurred_date");
CREATE INDEX "idx_claim_event_type" ON "claim_event"("event_type");

ALTER TABLE "claim_case" ALTER COLUMN "event_id" SET NOT NULL;
CREATE INDEX "idx_claim_case_event_id" ON "claim_case"("event_id");

-- 事件与人员、案件之间仅通过业务字段关联，不创建数据库外键。
