ALTER TABLE "operation_audit"
  ADD COLUMN "action" VARCHAR(80) NOT NULL DEFAULT 'api_mutation',
  ADD COLUMN "description" VARCHAR(300);

CREATE INDEX "idx_operation_audit_action_occurred"
  ON "operation_audit" ("action", "occurred_at");

COMMENT ON COLUMN "operation_audit"."action" IS '关键操作标识，例如 claim_view、claim_transition_history_view、api_mutation';
COMMENT ON COLUMN "operation_audit"."description" IS '面向审计人员展示的操作说明，不包含敏感业务内容';
