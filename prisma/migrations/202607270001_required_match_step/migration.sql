UPDATE "benefit_calculation_formula"
SET "match_expression" = '医疗总费用 > 0',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "match_expression" IS NULL
   OR btrim("match_expression") = '';
