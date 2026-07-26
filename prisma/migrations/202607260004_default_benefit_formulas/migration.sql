INSERT INTO "benefit_calculation_formula" (
  "id", "policy_id", "benefit_id", "formula_name", "match_expression", "steps", "enabled", "created_at", "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || benefit.id),
  product.policy_id,
  benefit.id,
  benefit.benefit_name || '自动理算公式',
  NULL,
  '[
    {"id":"eligible","name":"计算可理算费用","expression":"MAX(0, bill.totalAmount - bill.selfPaidAmount)","result":false},
    {"id":"deductible","name":"累计本次免赔额","expression":"MIN(step.eligible, MAX(0, config.DEDUCTIBLE - ledger.deductible_used))","result":false,"ledgerTarget":{"code":"deductible_used","name":"年度累计免赔额"}},
    {"id":"payable_base","name":"扣除免赔额","expression":"MAX(0, step.eligible - step.deductible)","result":false},
    {"id":"gross_payment","name":"按比例计算给付","expression":"step.payable_base * IF(config.REIMBURSEMENT_RATE > 0, config.REIMBURSEMENT_RATE / 100, 1)","result":false},
    {"id":"payment","name":"应用单次及年度限额","expression":"MIN(step.gross_payment, IF(config.PER_OCCURRENCE_LIMIT > 0, config.PER_OCCURRENCE_LIMIT, step.gross_payment), IF(config.ANNUAL_LIMIT > 0, MAX(0, config.ANNUAL_LIMIT - ledger.annual_payment), step.gross_payment))","result":true,"ledgerTarget":{"code":"annual_payment","name":"年度累计给付金额"}},
    {"id":"limit_record","name":"累计已使用限额","expression":"step.payment","result":false,"ledgerTarget":{"code":"limit_used","name":"年度累计使用限额"}}
  ]'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "policy_benefit" benefit
JOIN "policy_product" product ON product.id = benefit.policy_product_id
WHERE benefit.benefit_status = 'active'
  AND benefit.claimable_flag = true
ON CONFLICT ("benefit_id") DO NOTHING;
