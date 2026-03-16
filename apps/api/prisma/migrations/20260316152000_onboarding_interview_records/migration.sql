-- CreateTable
CREATE TABLE "onboarding_interview_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_interview_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_interview_records_session_id_turn_index_key"
ON "onboarding_interview_records"("session_id", "turn_index");

-- CreateIndex
CREATE INDEX "onboarding_interview_records_user_id_created_at_idx"
ON "onboarding_interview_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "onboarding_interview_records_session_id_created_at_idx"
ON "onboarding_interview_records"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "onboarding_interview_records"
ADD CONSTRAINT "onboarding_interview_records_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
