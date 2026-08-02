-- 配置参数定义仅保留“限额”和“免赔额”两个基础项目。
-- 原“年度累计赔付限额”作为限额基础定义保留并改名，其他定义及其配置删除。

BEGIN;

DELETE FROM "calculation_parameter"
WHERE "definition_id" NOT IN (
  'definition-annual_limit',
  'definition-deductible'
);

UPDATE "calculation_parameter_definition"
SET
  "parameter_code" = 'LIMIT',
  "parameter_name" = '限额',
  "value_type" = 'amount',
  "unit" = '元',
  "applicable_scopes" = '["policy","plan","product","benefit"]'::JSONB,
  "description" = '当前配置层级的赔付限额',
  "enabled" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'definition-annual_limit';

UPDATE "calculation_parameter_definition"
SET
  "parameter_name" = '免赔额',
  "value_type" = 'amount',
  "unit" = '元',
  "applicable_scopes" = '["policy","plan","product","benefit"]'::JSONB,
  "description" = '当前配置层级的免赔额',
  "enabled" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'definition-deductible';

DELETE FROM "calculation_parameter_definition"
WHERE "id" NOT IN (
  'definition-annual_limit',
  'definition-deductible'
);

COMMIT;
