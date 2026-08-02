-- 理算参数目录中的参数创建后直接生效；台账时间范围由参数名称表达，不再重复存储。
ALTER TABLE "calculation_parameter_catalog"
  DROP COLUMN IF EXISTS "enabled",
  DROP COLUMN IF EXISTS "time_range";

COMMENT ON TABLE "calculation_parameter_catalog" IS '统一理算参数目录，保存理算参数代码、名称、类型、取值约束和责任范围';
