UPDATE "benefit_calculation_formula"
SET "enabled" = true,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "enabled" = false;
