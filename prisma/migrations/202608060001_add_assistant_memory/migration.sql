CREATE TABLE "assistant_memory_turn" (
    "id" VARCHAR(50) NOT NULL,
    "task_id" VARCHAR(50) NOT NULL,
    "user_id" VARCHAR(100) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "user_text" TEXT NOT NULL,
    "assistant_reply" TEXT NOT NULL,
    "recognized" JSONB NOT NULL,
    "tool_calls" JSONB NOT NULL,
    "page_path" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_memory_turn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_memory_turn_task_id_key" ON "assistant_memory_turn"("task_id");
CREATE INDEX "idx_assistant_memory_user_created" ON "assistant_memory_turn"("user_id", "created_at");
