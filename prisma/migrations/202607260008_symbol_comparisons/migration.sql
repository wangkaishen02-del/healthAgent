UPDATE "benefit_calculation_formula"
SET "steps" = replace(
  replace(
    replace(
      replace(
        replace(
          replace("steps"::text, '大于等于', '≥'),
          '小于等于', '≤'
        ),
        '不等于', '≠'
      ),
      '等于', '='
    ),
    '大于', '>'
  ),
  '小于', '<'
)::jsonb,
"match_expression" = replace(
  replace(
    replace(
      replace(
        replace(
          replace(COALESCE("match_expression", ''), '大于等于', '≥'),
          '小于等于', '≤'
        ),
        '不等于', '≠'
      ),
      '等于', '='
    ),
    '大于', '>'
  ),
  '小于', '<'
),
"updated_at" = CURRENT_TIMESTAMP;
