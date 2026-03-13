-- Enable pgvector for embedding storage and similarity search.
CREATE EXTENSION IF NOT EXISTS vector;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('onboarding', 'active', 'restricted');

-- CreateEnum
CREATE TYPE "UserTagType" AS ENUM ('PUBLIC_VISIBLE', 'HIDDEN_SYSTEM');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('pending', 'active_sandbox', 'wall_broken', 'rejected');

-- CreateEnum
CREATE TYPE "AiAction" AS ENUM ('passed', 'blocked', 'modified');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "auth_provider_id" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'onboarding',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "real_avatar" TEXT,
    "real_name" TEXT,
    "is_wall_broken" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_tags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "UserTagType" NOT NULL,
    "tag_name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "ai_justification" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'pending',
    "resonance_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_messages" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "original_text" TEXT NOT NULL,
    "ai_rewritten_text" TEXT NOT NULL,
    "ai_action" "AiAction" NOT NULL,
    "hidden_tag_updates" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_id_key" ON "users"("auth_provider_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "user_tags_user_id_type_idx" ON "user_tags"("user_id", "type");

-- CreateIndex
CREATE INDEX "user_tags_tag_name_idx" ON "user_tags"("tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "user_tags_user_id_type_tag_name_key" ON "user_tags"("user_id", "type", "tag_name");

-- CreateIndex
CREATE INDEX "matches_status_idx" ON "matches"("status");

-- CreateIndex
CREATE INDEX "matches_user_a_id_status_idx" ON "matches"("user_a_id", "status");

-- CreateIndex
CREATE INDEX "matches_user_b_id_status_idx" ON "matches"("user_b_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_a_id_user_b_id_key" ON "matches"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "sandbox_messages_match_id_created_at_idx" ON "sandbox_messages"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "sandbox_messages_sender_id_created_at_idx" ON "sandbox_messages"("sender_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_messages" ADD CONSTRAINT "sandbox_messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_messages" ADD CONSTRAINT "sandbox_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Enforce product-level invariants for the matching engine.
ALTER TABLE "matches" ADD CONSTRAINT "matches_resonance_score_range_check" CHECK ("resonance_score" BETWEEN 0 AND 100);
ALTER TABLE "matches" ADD CONSTRAINT "matches_distinct_users_check" CHECK ("user_a_id" <> "user_b_id");
