CREATE TABLE "app_user_snapshot" (
  "user_id" VARCHAR(100) NOT NULL,
  "username" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(150) NOT NULL,
  "email" VARCHAR(200),
  "roles" JSONB NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_user_snapshot_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX "idx_app_user_snapshot_username" ON "app_user_snapshot"("username");
CREATE INDEX "idx_app_user_snapshot_last_seen" ON "app_user_snapshot"("last_seen_at");

CREATE TABLE "operation_audit" (
  "id" VARCHAR(50) NOT NULL,
  "actor_user_id" VARCHAR(100) NOT NULL,
  "actor_username" VARCHAR(100) NOT NULL,
  "actor_name" VARCHAR(150) NOT NULL,
  "actor_roles" JSONB NOT NULL,
  "method" VARCHAR(10) NOT NULL,
  "path" VARCHAR(300) NOT NULL,
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" VARCHAR(100),
  "outcome" VARCHAR(20) NOT NULL,
  "status_code" INTEGER NOT NULL,
  "error_code" VARCHAR(100),
  "request_id" VARCHAR(100) NOT NULL,
  "ip_address" VARCHAR(100),
  "user_agent" VARCHAR(300),
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operation_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_operation_audit_actor_time" ON "operation_audit"("actor_user_id", "occurred_at");
CREATE INDEX "idx_operation_audit_resource_time" ON "operation_audit"("resource_type", "resource_id", "occurred_at");
CREATE INDEX "idx_operation_audit_outcome_time" ON "operation_audit"("outcome", "occurred_at");
CREATE INDEX "idx_operation_audit_request_id" ON "operation_audit"("request_id");
