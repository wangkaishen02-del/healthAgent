-- 台账参数拥有独立的时间范围和责任范围，因此从通用理算参数目录中拆出。
CREATE TABLE "calculation_ledger_parameter_catalog" (
  "id" SERIAL PRIMARY KEY,
  "parameter_code" VARCHAR(6) NOT NULL,
  "policy_id" VARCHAR(50),
  "parameter_name" VARCHAR(100) NOT NULL,
  "value_type" VARCHAR(30) NOT NULL,
  "unit" VARCHAR(30),
  "time_range" VARCHAR(20) NOT NULL,
  "responsibility_range" VARCHAR(30) NOT NULL,
  "default_value" TEXT,
  "custom" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calculation_ledger_parameter_catalog_parameter_code_key" UNIQUE ("parameter_code"),
  CONSTRAINT "ck_ledger_parameter_time_range" CHECK ("time_range" IN ('year', 'month', 'day')),
  CONSTRAINT "ck_ledger_parameter_responsibility_range" CHECK ("responsibility_range" IN ('benefit', 'product', 'plan', 'event'))
);

CREATE INDEX "idx_calculation_ledger_parameter_catalog_policy"
  ON "calculation_ledger_parameter_catalog" ("policy_id");
CREATE UNIQUE INDEX "uk_calculation_ledger_parameter_catalog_global_name"
  ON "calculation_ledger_parameter_catalog" ("parameter_name") WHERE "policy_id" IS NULL;
CREATE UNIQUE INDEX "uk_calculation_ledger_parameter_catalog_policy_name"
  ON "calculation_ledger_parameter_catalog" ("policy_id", "parameter_name") WHERE "policy_id" IS NOT NULL;

INSERT INTO "calculation_ledger_parameter_catalog"
  ("id", "parameter_code", "policy_id", "parameter_name", "value_type", "unit",
   "time_range", "responsibility_range", "default_value", "custom", "created_at", "updated_at")
SELECT
  "id", "parameter_code", "policy_id", "parameter_name", "value_type", "unit",
  "time_range", "responsibility_range", "default_value", "custom", "created_at", "updated_at"
FROM "calculation_parameter_catalog"
WHERE "category" = 'ledger';

SELECT setval(
  pg_get_serial_sequence('"calculation_ledger_parameter_catalog"', 'id'),
  GREATEST(COALESCE((SELECT MAX("id") FROM "calculation_ledger_parameter_catalog"), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_ledger_parameter_catalog")
);

DELETE FROM "calculation_parameter_catalog" WHERE "category" = 'ledger';

ALTER TABLE "calculation_parameter_catalog"
  DROP CONSTRAINT IF EXISTS "ck_calculation_parameter_catalog_time_range",
  DROP COLUMN "time_range",
  DROP COLUMN "responsibility_range",
  ADD CONSTRAINT "ck_calculation_parameter_catalog_non_ledger"
    CHECK ("category" <> 'ledger');

CREATE OR REPLACE FUNCTION "assign_calculation_ledger_parameter_code"()
RETURNS TRIGGER AS $$
DECLARE
  next_value BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."parameter_code" IS DISTINCT FROM OLD."parameter_code" THEN
    RAISE EXCEPTION 'parameter_code cannot be changed';
  END IF;
  IF NEW."parameter_code" IS NULL OR NEW."parameter_code" = '' THEN
    next_value := nextval('"calculation_parameter_tz_seq"');
    IF next_value > 9999 THEN
      RAISE EXCEPTION 'calculation ledger parameter code sequence exhausted';
    END IF;
    NEW."parameter_code" := 'TZ' || LPAD(next_value::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_assign_calculation_ledger_parameter_code"
BEFORE INSERT OR UPDATE OF "parameter_code" ON "calculation_ledger_parameter_catalog"
FOR EACH ROW EXECUTE FUNCTION "assign_calculation_ledger_parameter_code"();

COMMENT ON TABLE "calculation_parameter_catalog" IS '通用理算参数目录，保存账单、事件和配置参数，不包含台账参数';
COMMENT ON TABLE "calculation_ledger_parameter_catalog" IS '台账理算参数目录，独立保存时间范围和责任范围';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."id" IS '自增主键';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."parameter_code" IS '台账参数代码：TZ加四位自增序号，创建后不可修改';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."policy_id" IS '所属保单；为空表示全局内置台账参数';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."parameter_name" IS '台账参数中文名称';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."value_type" IS '参数值类型';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."unit" IS '显示单位';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."time_range" IS '时间范围：year年、month月、day日';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."responsibility_range" IS '责任范围：benefit责任、product险种、plan保障计划、event事件';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."default_value" IS '自定义台账参数默认值';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."custom" IS '是否由操作人员自定义';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."created_at" IS '创建时间';
COMMENT ON COLUMN "calculation_ledger_parameter_catalog"."updated_at" IS '更新时间';

-- 新增可配置的赔付比例参数定义。
INSERT INTO "calculation_parameter_definition"
  ("id", "parameter_code", "parameter_name", "value_type", "unit", "applicable_scopes", "description", "enabled", "created_at", "updated_at")
VALUES
  ('definition-payment-ratio', 'PAYMENT_RATIO', '赔付比例', 'percentage', '%',
   '["policy","plan","product","benefit"]'::JSONB, '当前配置层级的赔付比例。', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("parameter_code") DO UPDATE
SET
  "parameter_name" = EXCLUDED."parameter_name",
  "value_type" = EXCLUDED."value_type",
  "unit" = EXCLUDED."unit",
  "applicable_scopes" = EXCLUDED."applicable_scopes",
  "description" = EXCLUDED."description",
  "enabled" = TRUE,
  "updated_at" = CURRENT_TIMESTAMP;
