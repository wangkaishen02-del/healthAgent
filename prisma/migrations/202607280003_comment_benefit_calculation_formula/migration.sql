-- 补齐责任自动理算公式表及全部字段的中文数据字典注释。

BEGIN;

COMMENT ON TABLE "benefit_calculation_formula" IS '责任自动理算公式配置表';
COMMENT ON COLUMN "benefit_calculation_formula"."id" IS '责任公式自增主键';
COMMENT ON COLUMN "benefit_calculation_formula"."policy_id" IS '所属保单标识';
COMMENT ON COLUMN "benefit_calculation_formula"."benefit_id" IS '所属责任标识';
COMMENT ON COLUMN "benefit_calculation_formula"."formula_name" IS '公式名称';
COMMENT ON COLUMN "benefit_calculation_formula"."match_expression" IS '账单自动匹配条件表达式';
COMMENT ON COLUMN "benefit_calculation_formula"."steps" IS '公式步骤集合';
COMMENT ON COLUMN "benefit_calculation_formula"."enabled" IS '历史启用标记，现有公式均直接使用';
COMMENT ON COLUMN "benefit_calculation_formula"."created_at" IS '创建时间';
COMMENT ON COLUMN "benefit_calculation_formula"."updated_at" IS '更新时间';

COMMIT;
