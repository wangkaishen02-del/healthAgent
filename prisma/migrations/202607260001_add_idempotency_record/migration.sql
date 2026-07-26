CREATE TABLE "idempotency_record" (
    "id" VARCHAR(50) NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "operation_key" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_idempotency_scope_operation_key"
ON "idempotency_record"("scope", "operation_key");

CREATE INDEX "idx_idempotency_created_at"
ON "idempotency_record"("created_at");
