-- 字典项只保留业务代码和中文名称；业务数据直接保存 item_code。
ALTER TABLE "system_dictionary"
  DROP CONSTRAINT IF EXISTS "uk_system_dictionary_type_value";

ALTER TABLE "system_dictionary"
  DROP COLUMN IF EXISTS "item_value";

COMMENT ON COLUMN "system_dictionary"."item_code" IS '字典项业务代码，业务表和接口直接保存此值';
COMMENT ON COLUMN "system_dictionary"."item_name" IS '字典项中文显示名称';
COMMENT ON TABLE "system_dictionary" IS '统一业务字典表，保存字典类型、业务代码和中文名称';

-- 将当前已用于理算的字典字段统一为 item_code。
UPDATE "claim_bill"
SET "bill_type" = CASE "bill_type"
  WHEN 'outpatient' THEN '1'
  WHEN 'inpatient' THEN '2'
  WHEN 'special_outpatient' THEN '3'
  WHEN 'pharmacy' THEN '4'
  WHEN 'other' THEN '9'
  ELSE "bill_type"
END;

UPDATE "claim_bill"
SET "medical_insurance_type" = CASE "medical_insurance_type"
  WHEN 'employee' THEN '1'
  WHEN 'resident' THEN '2'
  WHEN 'new_rural' THEN '3'
  WHEN 'commercial' THEN '4'
  WHEN 'self_pay' THEN '5'
  WHEN 'other' THEN '9'
  ELSE "medical_insurance_type"
END;

ALTER TABLE "claim_event"
  ALTER COLUMN "event_type" TYPE VARCHAR(30)
  USING (
    CASE "event_type"::text
      WHEN 'disease' THEN '1'
      WHEN 'accident' THEN '2'
      WHEN 'other' THEN '9'
      ELSE "event_type"::text
    END
  );

DROP TYPE IF EXISTS "ClaimEventType";

COMMENT ON COLUMN "claim_bill"."bill_type" IS '账单类型代码，关联 system_dictionary.bill_type';
COMMENT ON COLUMN "claim_bill"."medical_insurance_type" IS '医保类型代码，关联 system_dictionary.medical_insurance_type';
COMMENT ON COLUMN "claim_event"."event_type" IS '事件类型代码，关联 system_dictionary.event_type';

-- 参数代码按类别生成：BQ=账单、SJ=事件、TZ=台账、PZ=配置。
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_bq_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_sj_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_tz_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_pz_seq" START 1;

ALTER TABLE "calculation_parameter_catalog"
  ADD COLUMN "parameter_code" VARCHAR(6);

WITH numbered AS (
  SELECT
    "id",
    CASE "category"
      WHEN 'bill' THEN 'BQ'
      WHEN 'event' THEN 'SJ'
      WHEN 'ledger' THEN 'TZ'
      ELSE 'PZ'
    END AS prefix,
    ROW_NUMBER() OVER (
      PARTITION BY CASE "category"
        WHEN 'bill' THEN 'BQ'
        WHEN 'event' THEN 'SJ'
        WHEN 'ledger' THEN 'TZ'
        ELSE 'PZ'
      END
      ORDER BY "id"
    ) AS sequence_no
  FROM "calculation_parameter_catalog"
)
UPDATE "calculation_parameter_catalog" AS catalog
SET "parameter_code" = numbered.prefix || LPAD(numbered.sequence_no::text, 4, '0')
FROM numbered
WHERE catalog."id" = numbered."id";

SELECT setval(
  '"calculation_parameter_bq_seq"',
  GREATEST(COALESCE((SELECT MAX(SUBSTRING("parameter_code" FROM 3)::integer) FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'BQ%'), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'BQ%')
);
SELECT setval(
  '"calculation_parameter_sj_seq"',
  GREATEST(COALESCE((SELECT MAX(SUBSTRING("parameter_code" FROM 3)::integer) FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'SJ%'), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'SJ%')
);
SELECT setval(
  '"calculation_parameter_tz_seq"',
  GREATEST(COALESCE((SELECT MAX(SUBSTRING("parameter_code" FROM 3)::integer) FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'TZ%'), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'TZ%')
);
SELECT setval(
  '"calculation_parameter_pz_seq"',
  GREATEST(COALESCE((SELECT MAX(SUBSTRING("parameter_code" FROM 3)::integer) FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'PZ%'), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_parameter_catalog" WHERE "parameter_code" LIKE 'PZ%')
);

CREATE OR REPLACE FUNCTION "assign_calculation_parameter_code"()
RETURNS TRIGGER AS $$
DECLARE
  prefix_value VARCHAR(2);
  next_value BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."parameter_code" IS DISTINCT FROM OLD."parameter_code" THEN
    RAISE EXCEPTION 'parameter_code cannot be changed';
  END IF;

  IF NEW."parameter_code" IS NULL OR NEW."parameter_code" = '' THEN
    prefix_value := CASE NEW."category"
      WHEN 'bill' THEN 'BQ'
      WHEN 'event' THEN 'SJ'
      WHEN 'ledger' THEN 'TZ'
      ELSE 'PZ'
    END;
    next_value := CASE prefix_value
      WHEN 'BQ' THEN nextval('"calculation_parameter_bq_seq"')
      WHEN 'SJ' THEN nextval('"calculation_parameter_sj_seq"')
      WHEN 'TZ' THEN nextval('"calculation_parameter_tz_seq"')
      ELSE nextval('"calculation_parameter_pz_seq"')
    END;
    IF next_value > 9999 THEN
      RAISE EXCEPTION 'calculation parameter code sequence exhausted for prefix %', prefix_value;
    END IF;
    NEW."parameter_code" := prefix_value || LPAD(next_value::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_assign_calculation_parameter_code"
BEFORE INSERT OR UPDATE OF "parameter_code" ON "calculation_parameter_catalog"
FOR EACH ROW EXECUTE FUNCTION "assign_calculation_parameter_code"();

ALTER TABLE "calculation_parameter_catalog"
  ALTER COLUMN "parameter_code" SET NOT NULL,
  DROP COLUMN IF EXISTS "source_table",
  DROP COLUMN IF EXISTS "source_field",
  DROP COLUMN IF EXISTS "base_name",
  DROP COLUMN IF EXISTS "description";

CREATE UNIQUE INDEX "calculation_parameter_catalog_parameter_code_key"
  ON "calculation_parameter_catalog"("parameter_code");

COMMENT ON COLUMN "calculation_parameter_catalog"."parameter_code" IS '理算参数代码：两位类别前缀加四位自增序号，创建后不可修改';
COMMENT ON COLUMN "calculation_parameter_catalog"."category" IS '参数类别：bill账单、event事件、ledger台账、benefit配置';
COMMENT ON COLUMN "calculation_parameter_catalog"."parameter_name" IS '界面展示及中文公式使用的参数名称';
COMMENT ON TABLE "calculation_parameter_catalog" IS '统一理算参数目录，保存理算参数代码、名称、类型、取值约束和适用范围';
