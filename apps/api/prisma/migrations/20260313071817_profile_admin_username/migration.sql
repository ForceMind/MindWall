-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "anonymous_avatar" TEXT,
ADD COLUMN     "anonymous_name" VARCHAR(64),
ADD COLUMN     "gender" VARCHAR(16);
