-- CreateTable
CREATE TABLE "onboarding_interview_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "answer_count" INTEGER NOT NULL DEFAULT 0,
    "total_questions" INTEGER NOT NULL DEFAULT 4,
    "invalid_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "onboarding_interview_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_interview_sessions_user_id_status_updated_at_idx"
ON "onboarding_interview_sessions"("user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "onboarding_interview_sessions_status_updated_at_idx"
ON "onboarding_interview_sessions"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "onboarding_interview_sessions"
ADD CONSTRAINT "onboarding_interview_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnboardingSessionStatus') THEN
    CREATE TYPE "OnboardingSessionStatus" AS ENUM ('in_progress', 'completed', 'blocked');
  END IF;
END $$;
