ALTER TABLE "claim_case"
  ADD COLUMN "current_handler_user_id" VARCHAR(50) NOT NULL DEFAULT 'default-user',
  ADD COLUMN "current_handler_name" VARCHAR(100) NOT NULL DEFAULT '默认用户';

ALTER TABLE "claim_case_transition"
  ADD COLUMN "target_user_id" VARCHAR(50) NOT NULL DEFAULT 'default-user',
  ADD COLUMN "target_user_name" VARCHAR(100) NOT NULL DEFAULT '默认用户';

UPDATE "claim_case_transition"
SET "target_user_id" = "operator_user_id",
    "target_user_name" = "operator_name";

CREATE INDEX "idx_claim_case_handler_status_updated"
  ON "claim_case"("current_handler_user_id", "status", "updated_at");

CREATE INDEX "idx_claim_case_transition_target_occurred"
  ON "claim_case_transition"("target_user_id", "occurred_at");

COMMENT ON COLUMN "claim_case"."current_handler_user_id" IS '当前处理用户标识；回退时恢复为上一环节提交人';
COMMENT ON COLUMN "claim_case"."current_handler_name" IS '当前处理人姓名快照';
COMMENT ON COLUMN "claim_case_transition"."target_user_id" IS '本次流转目标用户标识';
COMMENT ON COLUMN "claim_case_transition"."target_user_name" IS '本次流转目标用户姓名快照';
COMMENT ON COLUMN "claim_case_transition"."action" IS '流转动作：create、submit、calculate、rollback、rollback_calculation、submit_review、complete、cancel、legacy_import';
