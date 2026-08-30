CREATE TABLE "claim_case_transition" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "from_status" VARCHAR(30),
  "to_status" VARCHAR(30) NOT NULL,
  "operator_user_id" VARCHAR(50) NOT NULL,
  "operator_name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(300),
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_case_transition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_case_transition_claim_case_id_fkey" FOREIGN KEY ("claim_case_id") REFERENCES "claim_case"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_claim_case_transition_case_occurred" ON "claim_case_transition"("claim_case_id", "occurred_at");
CREATE INDEX "idx_claim_case_transition_operator_occurred" ON "claim_case_transition"("operator_user_id", "occurred_at");
CREATE INDEX "idx_claim_case_transition_status_occurred" ON "claim_case_transition"("to_status", "occurred_at");

INSERT INTO "claim_case_transition" ("id", "claim_case_id", "action", "from_status", "to_status", "operator_user_id", "operator_name", "description", "occurred_at")
SELECT gen_random_uuid()::text, "id", 'create', NULL, 'registered', 'default-user', '默认用户', '历史案件创建记录', "created_at"
FROM "claim_case";

INSERT INTO "claim_case_transition" ("id", "claim_case_id", "action", "from_status", "to_status", "operator_user_id", "operator_name", "description", "occurred_at")
SELECT gen_random_uuid()::text, "id", 'legacy_import', 'registered', "status"::text, 'default-user', '默认用户', '历史状态导入，原中间节点与准确时间无法还原', "updated_at"
FROM "claim_case"
WHERE "status"::text <> 'registered';

COMMENT ON TABLE "claim_case_transition" IS '案件状态流转历史表，只追加不更新';
COMMENT ON COLUMN "claim_case_transition"."action" IS '流转动作：create、submit、submit_review、complete、cancel、legacy_import';
COMMENT ON COLUMN "claim_case_transition"."operator_user_id" IS '操作用户标识；当前为默认用户，后续关联用户体系';
COMMENT ON COLUMN "claim_case_transition"."operator_name" IS '操作人姓名快照，避免用户资料变化影响历史审计';
