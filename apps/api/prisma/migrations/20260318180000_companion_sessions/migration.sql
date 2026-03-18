-- CreateTable
CREATE TABLE "companion_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "persona_id" VARCHAR(64) NOT NULL,
    "persona_name" VARCHAR(128) NOT NULL,
    "persona_summary" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active_sandbox',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companion_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companion_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender_type" VARCHAR(32) NOT NULL,
    "original_text" TEXT,
    "ai_rewritten_text" TEXT NOT NULL,
    "ai_action" "AiAction" NOT NULL DEFAULT 'passed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companion_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companion_sessions_user_id_idx" ON "companion_sessions"("user_id");

-- CreateIndex
CREATE INDEX "companion_sessions_updated_at_idx" ON "companion_sessions"("updated_at");

-- CreateIndex
CREATE INDEX "companion_messages_session_id_created_at_idx" ON "companion_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "companion_sessions" ADD CONSTRAINT "companion_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_messages" ADD CONSTRAINT "companion_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "companion_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
