-- Fix: Convert status column from TEXT to OnboardingSessionStatus enum
-- This handles the case where the migration was applied with TEXT type

-- Ensure enum type exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnboardingSessionStatus') THEN
    CREATE TYPE "OnboardingSessionStatus" AS ENUM ('in_progress', 'completed', 'blocked');
  END IF;
END $$;

-- Convert column type from TEXT to enum if it's still TEXT
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_interview_sessions'
      AND column_name = 'status'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE "onboarding_interview_sessions"
      ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "onboarding_interview_sessions"
      ALTER COLUMN "status" TYPE "OnboardingSessionStatus"
      USING "status"::"OnboardingSessionStatus";
    ALTER TABLE "onboarding_interview_sessions"
      ALTER COLUMN "status" SET DEFAULT 'in_progress';
  END IF;
END $$;
