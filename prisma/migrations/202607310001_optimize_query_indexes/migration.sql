-- Match the indexes to the application's most frequent filter + sort paths.
CREATE INDEX IF NOT EXISTS "idx_claim_case_updated_at"
  ON "claim_case" ("updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_claim_case_status_updated_at"
  ON "claim_case" ("status", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_claim_event_person_type_date"
  ON "claim_event" ("insured_person_id", "event_type", "occurred_date" DESC);

DROP INDEX IF EXISTS "idx_calculation_parameter_catalog_policy_category";
CREATE INDEX "idx_calculation_parameter_catalog_policy_category"
  ON "calculation_parameter_catalog" ("policy_id", "category", "parameter_name");

DROP INDEX IF EXISTS "idx_calculation_ledger_parameter_catalog_policy";
CREATE INDEX "idx_calculation_ledger_parameter_catalog_policy"
  ON "calculation_ledger_parameter_catalog" ("policy_id", "parameter_name");
