-- 新增统一业务字典表和统一理算参数主表。
-- 字典编码用于对外配置（例如账单类型 1=门诊），item_value 保留现有程序存储值，避免破坏历史数据。
-- 理算参数主表统一登记账单、事件、台账、配置及自定义参数。

BEGIN;

CREATE TABLE "system_dictionary" (
  "id" SERIAL PRIMARY KEY,
  "dictionary_type" VARCHAR(60) NOT NULL,
  "type_name" VARCHAR(100) NOT NULL,
  "item_code" VARCHAR(30) NOT NULL,
  "item_value" VARCHAR(80) NOT NULL,
  "item_name" VARCHAR(150) NOT NULL,
  "sequence_no" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uk_system_dictionary_type_code" UNIQUE ("dictionary_type", "item_code"),
  CONSTRAINT "uk_system_dictionary_type_value" UNIQUE ("dictionary_type", "item_value")
);

CREATE INDEX "idx_system_dictionary_type_enabled_sequence"
  ON "system_dictionary" ("dictionary_type", "enabled", "sequence_no");

COMMENT ON TABLE "system_dictionary" IS '统一业务字典表，保存各类编码、程序存储值和中文名称';
COMMENT ON COLUMN "system_dictionary"."id" IS '自增主键';
COMMENT ON COLUMN "system_dictionary"."dictionary_type" IS '字典类型标识';
COMMENT ON COLUMN "system_dictionary"."type_name" IS '字典类型中文名称';
COMMENT ON COLUMN "system_dictionary"."item_code" IS '业务字典编码，例如账单类型1代表门诊';
COMMENT ON COLUMN "system_dictionary"."item_value" IS '程序及历史数据使用的存储值';
COMMENT ON COLUMN "system_dictionary"."item_name" IS '字典项中文名称';
COMMENT ON COLUMN "system_dictionary"."sequence_no" IS '显示顺序';
COMMENT ON COLUMN "system_dictionary"."enabled" IS '是否启用';
COMMENT ON COLUMN "system_dictionary"."description" IS '字典项说明';
COMMENT ON COLUMN "system_dictionary"."created_at" IS '创建时间';
COMMENT ON COLUMN "system_dictionary"."updated_at" IS '更新时间';

INSERT INTO "system_dictionary"
  ("dictionary_type", "type_name", "item_code", "item_value", "item_name", "sequence_no", "description")
VALUES
  ('bill_type', '账单类型', '1', 'outpatient', '门诊', 1, '普通门诊医疗账单'),
  ('bill_type', '账单类型', '2', 'inpatient', '住院', 2, '住院医疗账单'),
  ('bill_type', '账单类型', '3', 'special_outpatient', '门诊特殊病', 3, '门诊特殊病及门诊慢特病账单'),
  ('bill_type', '账单类型', '4', 'pharmacy', '药店购药', 4, '定点药店购药账单'),
  ('bill_type', '账单类型', '9', 'other', '其他费用', 9, '其他医疗费用账单'),
  ('medical_insurance_type', '医保类型', '1', 'employee', '城镇职工基本医疗保险', 1, NULL),
  ('medical_insurance_type', '医保类型', '2', 'resident', '城乡居民基本医疗保险', 2, NULL),
  ('medical_insurance_type', '医保类型', '3', 'new_rural', '新型农村合作医疗', 3, NULL),
  ('medical_insurance_type', '医保类型', '4', 'commercial', '商业健康保险', 4, NULL),
  ('medical_insurance_type', '医保类型', '5', 'self_pay', '全自费', 5, NULL),
  ('medical_insurance_type', '医保类型', '9', 'other', '其他', 9, NULL),
  ('event_type', '事件类型', '1', 'disease', '疾病', 1, NULL),
  ('event_type', '事件类型', '2', 'accident', '意外', 2, NULL),
  ('event_type', '事件类型', '9', 'other', '其他', 9, NULL),
  ('claim_case_status', '案件状态', '1', 'registered', '受理中', 1, NULL),
  ('claim_case_status', '案件状态', '2', 'processing', '处理中', 2, NULL),
  ('claim_case_status', '案件状态', '3', 'completed', '已结案', 3, NULL),
  ('claim_case_status', '案件状态', '4', 'cancelled', '已撤件', 4, NULL),
  ('claim_report_channel', '报案渠道', '1', 'online', '线上报案', 1, NULL),
  ('claim_report_channel', '报案渠道', '2', 'phone', '电话报案', 2, NULL),
  ('claim_report_channel', '报案渠道', '3', 'counter', '柜面报案', 3, NULL),
  ('claim_report_channel', '报案渠道', '9', 'other', '其他', 9, NULL),
  ('claim_payment_method', '赔付方式', '0', 'pending', '待确定', 0, NULL),
  ('claim_payment_method', '赔付方式', '1', 'bank_transfer', '银行转账', 1, NULL),
  ('claim_payment_method', '赔付方式', '2', 'cash', '现金', 2, NULL),
  ('claim_payment_method', '赔付方式', '9', 'other', '其他', 9, NULL),
  ('attachment_category', '影像件分类', '1', 'application', '申请材料', 1, NULL),
  ('attachment_category', '影像件分类', '2', 'identity', '身份材料', 2, NULL),
  ('attachment_category', '影像件分类', '3', 'medical', '医疗材料', 3, NULL),
  ('attachment_category', '影像件分类', '4', 'invoice', '医疗发票', 4, NULL),
  ('attachment_category', '影像件分类', '5', 'bank', '银行材料', 5, NULL),
  ('attachment_category', '影像件分类', '9', 'other', '其他', 9, NULL),
  ('gender', '性别', '1', 'male', '男', 1, NULL),
  ('gender', '性别', '2', 'female', '女', 2, NULL),
  ('gender', '性别', '9', 'unknown', '未知', 9, NULL),
  ('id_type', '证件类型', '1', 'id_card', '居民身份证', 1, NULL),
  ('id_type', '证件类型', '2', 'passport', '护照', 2, NULL),
  ('id_type', '证件类型', '9', 'other', '其他', 9, NULL),
  ('insured_role', '被保人关系', '1', 'employee', '员工本人', 1, NULL),
  ('insured_role', '被保人关系', '2', 'spouse', '配偶', 2, NULL),
  ('insured_role', '被保人关系', '3', 'child', '子女', 3, NULL),
  ('insured_role', '被保人关系', '4', 'parent', '父母', 4, NULL),
  ('insured_role', '被保人关系', '9', 'other', '其他', 9, NULL),
  ('policy_status', '保单状态', '1', 'enabled', '启用', 1, NULL),
  ('policy_status', '保单状态', '0', 'disabled', '停用', 2, NULL),
  ('product_status', '险种状态', '1', 'active', '有效', 1, NULL),
  ('product_status', '险种状态', '0', 'inactive', '无效', 2, NULL),
  ('benefit_status', '责任状态', '1', 'active', '有效', 1, NULL),
  ('benefit_status', '责任状态', '0', 'inactive', '无效', 2, NULL);

CREATE TABLE "calculation_parameter_catalog" (
  "id" SERIAL PRIMARY KEY,
  "policy_id" VARCHAR(50),
  "category" VARCHAR(30) NOT NULL,
  "parameter_name" VARCHAR(100) NOT NULL,
  "value_type" VARCHAR(30) NOT NULL,
  "unit" VARCHAR(30),
  "source_table" VARCHAR(80),
  "source_field" VARCHAR(80),
  "dictionary_type" VARCHAR(60),
  "time_range" VARCHAR(20),
  "responsibility_range" VARCHAR(30),
  "base_name" VARCHAR(100),
  "default_value" TEXT,
  "description" TEXT,
  "custom" BOOLEAN NOT NULL DEFAULT FALSE,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_calculation_parameter_catalog_policy_category"
  ON "calculation_parameter_catalog" ("policy_id", "category");
CREATE INDEX "idx_calculation_parameter_catalog_dictionary_type"
  ON "calculation_parameter_catalog" ("dictionary_type");
CREATE UNIQUE INDEX "uk_calculation_parameter_catalog_global_name"
  ON "calculation_parameter_catalog" ("parameter_name") WHERE "policy_id" IS NULL;
CREATE UNIQUE INDEX "uk_calculation_parameter_catalog_policy_name"
  ON "calculation_parameter_catalog" ("policy_id", "parameter_name") WHERE "policy_id" IS NOT NULL;

COMMENT ON TABLE "calculation_parameter_catalog" IS '统一理算参数主表，登记账单、事件、台账、配置和自定义理算参数';
COMMENT ON COLUMN "calculation_parameter_catalog"."id" IS '自增主键，也是自定义参数自动分配的唯一标识';
COMMENT ON COLUMN "calculation_parameter_catalog"."policy_id" IS '所属保单；为空表示全局内置参数';
COMMENT ON COLUMN "calculation_parameter_catalog"."category" IS '参数分类：bill账单、event事件、ledger台账、benefit配置或custom自定义';
COMMENT ON COLUMN "calculation_parameter_catalog"."parameter_name" IS '公式中使用的中文参数名称';
COMMENT ON COLUMN "calculation_parameter_catalog"."value_type" IS '值类型：number、amount、percentage、text、boolean或date';
COMMENT ON COLUMN "calculation_parameter_catalog"."unit" IS '显示单位';
COMMENT ON COLUMN "calculation_parameter_catalog"."source_table" IS '内置参数取值来源表';
COMMENT ON COLUMN "calculation_parameter_catalog"."source_field" IS '内置参数取值来源字段或竖表项目名称';
COMMENT ON COLUMN "calculation_parameter_catalog"."dictionary_type" IS '固定选项参数关联的字典类型';
COMMENT ON COLUMN "calculation_parameter_catalog"."time_range" IS '台账参数时间范围：year、month或day';
COMMENT ON COLUMN "calculation_parameter_catalog"."responsibility_range" IS '台账责任范围：benefit、product、plan或event';
COMMENT ON COLUMN "calculation_parameter_catalog"."base_name" IS '自定义台账参数录入的基础名称';
COMMENT ON COLUMN "calculation_parameter_catalog"."default_value" IS '自定义参数默认值';
COMMENT ON COLUMN "calculation_parameter_catalog"."description" IS '参数口径说明';
COMMENT ON COLUMN "calculation_parameter_catalog"."custom" IS '是否由操作人员自定义';
COMMENT ON COLUMN "calculation_parameter_catalog"."enabled" IS '是否启用';
COMMENT ON COLUMN "calculation_parameter_catalog"."created_at" IS '创建时间';
COMMENT ON COLUMN "calculation_parameter_catalog"."updated_at" IS '更新时间';

-- 原有自定义参数保留原自增主键，确保历史账单竖表引用可以无损迁移。
INSERT INTO "calculation_parameter_catalog"
  ("id", "policy_id", "category", "parameter_name", "value_type", "unit", "time_range",
   "responsibility_range", "base_name", "default_value", "description", "custom", "enabled",
   "created_at", "updated_at")
SELECT
  "id", "policy_id", "category", "variable_name", "value_type", "unit", "time_range",
  "responsibility_range", "base_name", "default_value", "description", "custom", "enabled",
  "created_at", "updated_at"
FROM "calculation_variable_definition";

SELECT setval(
  pg_get_serial_sequence('"calculation_parameter_catalog"', 'id'),
  GREATEST(COALESCE((SELECT MAX("id") FROM "calculation_parameter_catalog"), 0), 1),
  EXISTS (SELECT 1 FROM "calculation_parameter_catalog")
);

INSERT INTO "calculation_parameter_catalog"
  ("policy_id", "category", "parameter_name", "value_type", "unit", "source_table",
   "source_field", "dictionary_type", "time_range", "responsibility_range", "base_name",
   "description", "custom")
VALUES
  (NULL, 'bill', '医疗总费用', 'amount', '元', 'claim_bill', 'total_amount', NULL, NULL, NULL, NULL, '医疗发票价税合计或费用总额', FALSE),
  (NULL, 'bill', '自费金额', 'amount', '元', 'claim_bill_amount', '自费金额', NULL, NULL, NULL, NULL, '账单竖表中的自费金额', FALSE),
  (NULL, 'bill', '医保统筹支付', 'amount', '元', 'claim_bill_amount', '医保统筹支付', NULL, NULL, NULL, NULL, '账单竖表中的医保统筹支付金额', FALSE),
  (NULL, 'bill', '个人账户支付', 'amount', '元', 'claim_bill_amount', '个人账户支付', NULL, NULL, NULL, NULL, '账单竖表中的个人账户支付金额', FALSE),
  (NULL, 'bill', '个人现金支付', 'amount', '元', 'claim_bill_amount', '个人现金支付', NULL, NULL, NULL, NULL, '账单竖表中的个人现金支付金额', FALSE),
  (NULL, 'bill', '票据类型', 'text', NULL, 'claim_bill', 'bill_type', 'bill_type', NULL, NULL, NULL, '账单类型字典名称', FALSE),
  (NULL, 'bill', '收费日期', 'date', NULL, 'claim_bill', 'bill_date', NULL, NULL, NULL, NULL, '医疗票据收费日期', FALSE),
  (NULL, 'bill', '医保类型', 'text', NULL, 'claim_bill', 'medical_insurance_type', 'medical_insurance_type', NULL, NULL, NULL, '医保类型字典名称', FALSE),
  (NULL, 'event', '事件类型', 'text', NULL, 'claim_event', 'event_type', 'event_type', NULL, NULL, NULL, '理赔事件类型字典名称', FALSE),
  (NULL, 'event', '事件日期', 'date', NULL, 'claim_event', 'occurred_date', NULL, NULL, NULL, NULL, '理赔事件发生日期', FALSE),
  (NULL, 'event', '事件诊断', 'text', NULL, 'claim_event', 'diagnosis', NULL, NULL, NULL, NULL, '理赔事件诊断', FALSE),
  (NULL, 'ledger', '累计年免赔额（责任）', 'amount', '元', 'claim_ledger_balance', 'annual_deductible', NULL, 'year', 'benefit', '免赔额', '责任年度累计免赔额', FALSE),
  (NULL, 'ledger', '累计年给付金额（责任）', 'amount', '元', 'claim_ledger_balance', 'annual_payment', NULL, 'year', 'benefit', '给付金额', '责任年度累计给付金额', FALSE),
  (NULL, 'ledger', '累计年免赔额（险种）', 'amount', '元', 'claim_ledger_balance', 'annual_deductible', NULL, 'year', 'product', '免赔额', '险种年度累计免赔额', FALSE),
  (NULL, 'ledger', '累计年给付金额（险种）', 'amount', '元', 'claim_ledger_balance', 'annual_payment', NULL, 'year', 'product', '给付金额', '险种年度累计给付金额', FALSE),
  (NULL, 'ledger', '累计年免赔额（计划）', 'amount', '元', 'claim_ledger_balance', 'annual_deductible', NULL, 'year', 'plan', '免赔额', '保障计划年度累计免赔额', FALSE),
  (NULL, 'ledger', '累计年给付金额（计划）', 'amount', '元', 'claim_ledger_balance', 'annual_payment', NULL, 'year', 'plan', '给付金额', '保障计划年度累计给付金额', FALSE),
  (NULL, 'ledger', '累计年免赔额（事件）', 'amount', '元', 'claim_ledger_balance', 'annual_deductible', NULL, 'year', 'event', '免赔额', '事件年度累计免赔额', FALSE),
  (NULL, 'ledger', '累计年给付金额（事件）', 'amount', '元', 'claim_ledger_balance', 'annual_payment', NULL, 'year', 'event', '给付金额', '事件年度累计给付金额', FALSE),
  (NULL, 'benefit', '限额', 'amount', '元', 'calculation_parameter', '限额', NULL, NULL, NULL, NULL, '保单、计划、险种或责任层级配置的限额', FALSE),
  (NULL, 'benefit', '免赔额', 'amount', '元', 'calculation_parameter', '免赔额', NULL, NULL, NULL, NULL, '保单、计划、险种或责任层级配置的免赔额', FALSE);

ALTER TABLE "claim_bill_custom_value"
  RENAME COLUMN "variable_definition_id" TO "parameter_catalog_id";
ALTER INDEX "idx_claim_bill_custom_value_definition"
  RENAME TO "idx_claim_bill_custom_value_catalog";

COMMENT ON COLUMN "claim_bill_custom_value"."parameter_catalog_id" IS '关联统一理算参数主表自增主键';

DROP TABLE "calculation_variable_definition";

-- 新字典统一使用“门诊、住院”名称，兼容并更新已配置的旧公式文本。
UPDATE "benefit_calculation_formula"
SET
  "match_expression" = REPLACE(REPLACE("match_expression", '门诊账单', '门诊'), '住院账单', '住院'),
  "steps" = REPLACE(REPLACE("steps"::TEXT, '门诊账单', '门诊'), '住院账单', '住院')::JSONB,
  "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
