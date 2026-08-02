-- 台账参数的时间范围是独立业务属性，不再从参数名称推断。
ALTER TABLE "calculation_parameter_catalog"
  ADD COLUMN "time_range" VARCHAR(20);

-- 将已有台账参数一次性迁移为显式时间范围，迁移后运行时不再解析名称。
UPDATE "calculation_parameter_catalog"
SET "time_range" = CASE
  WHEN "parameter_name" LIKE '累计年%' THEN 'year'
  WHEN "parameter_name" LIKE '累计月%' THEN 'month'
  WHEN "parameter_name" LIKE '累计日%' THEN 'day'
  ELSE 'year'
END
WHERE "category" = 'ledger';

ALTER TABLE "calculation_parameter_catalog"
  ADD CONSTRAINT "ck_calculation_parameter_catalog_time_range"
  CHECK (
    ("category" = 'ledger' AND "time_range" IN ('year', 'month', 'day'))
    OR
    ("category" <> 'ledger' AND "time_range" IS NULL)
  );

COMMENT ON COLUMN "calculation_parameter_catalog"."time_range" IS '台账参数时间范围：year年、month月、day日；非台账参数为空';
COMMENT ON TABLE "calculation_parameter_catalog" IS '统一理算参数目录，保存理算参数代码、名称、类型、取值约束、时间范围和责任范围';
