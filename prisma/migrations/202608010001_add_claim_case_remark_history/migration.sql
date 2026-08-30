CREATE TABLE "claim_case_remark" (
  "id" VARCHAR(50) NOT NULL,
  "claim_case_id" VARCHAR(50) NOT NULL,
  "stage" VARCHAR(30) NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_case_remark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_case_remark_claim_case_id_fkey" FOREIGN KEY ("claim_case_id") REFERENCES "claim_case"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_claim_case_remark_case_created" ON "claim_case_remark"("claim_case_id", "created_at");

INSERT INTO "claim_case_remark" ("id", "claim_case_id", "stage", "content", "created_at")
SELECT gen_random_uuid()::text, "id", 'acceptance', "remark", "created_at"
FROM "claim_case"
WHERE "remark" IS NOT NULL AND btrim("remark") <> '';

COMMENT ON TABLE "claim_case_remark" IS '案件备注历史记录表';
COMMENT ON COLUMN "claim_case_remark"."stage" IS '备注录入阶段：acceptance、calculation、review';
COMMENT ON COLUMN "claim_case_remark"."content" IS '备注内容';
