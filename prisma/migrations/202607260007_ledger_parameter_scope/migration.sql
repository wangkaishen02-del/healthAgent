ALTER TABLE "calculation_variable_definition"
  ADD COLUMN "time_range" VARCHAR(20),
  ADD COLUMN "responsibility_range" VARCHAR(30),
  ADD COLUMN "base_name" VARCHAR(100);

UPDATE "benefit_calculation_formula"
SET "steps" = (
  SELECT jsonb_agg(
    CASE
      WHEN element->'ledgerTarget'->>'code' = 'deductible_used'
        THEN jsonb_set(element, '{ledgerTarget,code}', '"annual_deductible"'::jsonb)
      WHEN element->'ledgerTarget'->>'code' = 'limit_used'
        THEN element - 'ledgerTarget'
      ELSE element
    END
    ORDER BY ordinal
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS step(element, ordinal)
),
"updated_at" = CURRENT_TIMESTAMP;

UPDATE "benefit_calculation_formula"
SET "steps" = replace(
  replace("steps"::text, '年度已使用免赔额', '累计年免赔额（责任）'),
  '年度累计给付金额',
  '累计年给付金额（责任）'
)::jsonb,
"updated_at" = CURRENT_TIMESTAMP;
