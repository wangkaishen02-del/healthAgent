UPDATE "benefit_calculation_formula"
SET "steps" = replace("steps"::text, ' > ', ' 大于 ')::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "steps"::text LIKE '% > %';
