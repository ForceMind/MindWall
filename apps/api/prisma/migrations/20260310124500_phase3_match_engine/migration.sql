ALTER TABLE "user_profiles" ADD COLUMN "city" VARCHAR(128);

ALTER TABLE "matches" ADD COLUMN "ai_match_reason" TEXT;

CREATE INDEX "user_profiles_city_idx" ON "user_profiles"("city");
