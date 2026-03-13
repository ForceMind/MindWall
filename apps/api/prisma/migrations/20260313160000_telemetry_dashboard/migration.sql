ALTER TABLE "auth_sessions"
ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "auth_sessions_last_seen_at_idx"
ON "auth_sessions"("last_seen_at");

CREATE TABLE IF NOT EXISTS "ai_generation_logs" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "feature" VARCHAR(64) NOT NULL,
  "prompt_key" VARCHAR(64),
  "provider" VARCHAR(32) NOT NULL DEFAULT 'openai',
  "model" VARCHAR(128) NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_usd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_generation_logs_feature_created_at_idx"
ON "ai_generation_logs"("feature", "created_at");

CREATE INDEX IF NOT EXISTS "ai_generation_logs_user_id_created_at_idx"
ON "ai_generation_logs"("user_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generation_logs_user_id_fkey'
  ) THEN
    ALTER TABLE "ai_generation_logs"
    ADD CONSTRAINT "ai_generation_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id" UUID NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_templates_key_key"
ON "prompt_templates"("key");

CREATE INDEX IF NOT EXISTS "prompt_templates_category_is_active_idx"
ON "prompt_templates"("category", "is_active");
