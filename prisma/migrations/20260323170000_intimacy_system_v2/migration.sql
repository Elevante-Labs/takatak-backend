-- CreateEnum
CREATE TYPE "IntimacyActionType" AS ENUM ('CHAT', 'GIFT', 'CALL', 'ROOM');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('NONE', 'FRIEND', 'COUPLE');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED');

-- ============================================
-- Migrate existing "intimacies" table
-- Step 1: Add new columns as NULLABLE first
-- ============================================
ALTER TABLE "intimacies" ADD COLUMN "userAId" UUID;
ALTER TABLE "intimacies" ADD COLUMN "userBId" UUID;
ALTER TABLE "intimacies" ADD COLUMN "intimacyScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "intimacies" ADD COLUMN "relationshipType" "RelationshipType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "intimacies" ADD COLUMN "lastInteractionAt" TIMESTAMP(3);
ALTER TABLE "intimacies" ADD COLUMN "dailyChatRounds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "intimacies" ADD COLUMN "dailyChatDate" DATE;
ALTER TABLE "intimacies" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ============================================
-- Step 2: Migrate existing data (userId→userAId, hostId→userBId)
-- Normalize pair ordering: userAId < userBId (lexicographic)
-- ============================================
UPDATE "intimacies"
SET
  "userAId" = CASE WHEN "userId" < "hostId" THEN "userId" ELSE "hostId" END,
  "userBId" = CASE WHEN "userId" < "hostId" THEN "hostId" ELSE "userId" END,
  "intimacyScore" = "points",
  "lastInteractionAt" = "lastMessageAt";

-- ============================================
-- Step 3: Make new columns NOT NULL now that data is populated
-- ============================================
ALTER TABLE "intimacies" ALTER COLUMN "userAId" SET NOT NULL;
ALTER TABLE "intimacies" ALTER COLUMN "userBId" SET NOT NULL;

-- ============================================
-- Step 4: Update level default from 1 to 0 for new schema
-- ============================================
ALTER TABLE "intimacies" ALTER COLUMN "level" SET DEFAULT 0;

-- ============================================
-- Step 5: Drop old columns and constraints
-- ============================================
-- Drop old foreign keys
ALTER TABLE "intimacies" DROP CONSTRAINT IF EXISTS "intimacies_userId_fkey";
ALTER TABLE "intimacies" DROP CONSTRAINT IF EXISTS "intimacies_hostId_fkey";

-- Drop old unique index
DROP INDEX IF EXISTS "intimacies_userId_hostId_key";

-- Drop old indexes
DROP INDEX IF EXISTS "intimacies_userId_idx";
DROP INDEX IF EXISTS "intimacies_hostId_idx";

-- Drop old columns
ALTER TABLE "intimacies" DROP COLUMN "userId";
ALTER TABLE "intimacies" DROP COLUMN "hostId";
ALTER TABLE "intimacies" DROP COLUMN "points";
ALTER TABLE "intimacies" DROP COLUMN "lastMessageAt";

-- ============================================
-- Step 6: Add new indexes and constraints for intimacies
-- ============================================
CREATE UNIQUE INDEX "intimacies_userAId_userBId_key" ON "intimacies"("userAId", "userBId");
CREATE INDEX "intimacies_userAId_idx" ON "intimacies"("userAId");
CREATE INDEX "intimacies_userBId_idx" ON "intimacies"("userBId");
CREATE INDEX "intimacies_lastInteractionAt_idx" ON "intimacies"("lastInteractionAt");

-- Add new foreign keys
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Step 7: Create new tables
-- ============================================

-- CreateTable: IntimacyLog
CREATE TABLE "intimacy_logs" (
    "id" UUID NOT NULL,
    "intimacyId" UUID NOT NULL,
    "actionType" "IntimacyActionType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intimacy_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intimacy_logs_intimacyId_idx" ON "intimacy_logs"("intimacyId");
CREATE INDEX "intimacy_logs_actionType_idx" ON "intimacy_logs"("actionType");
CREATE INDEX "intimacy_logs_createdAt_idx" ON "intimacy_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "intimacy_logs" ADD CONSTRAINT "intimacy_logs_intimacyId_fkey" FOREIGN KEY ("intimacyId") REFERENCES "intimacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Relationship
CREATE TABLE "relationships" (
    "id" UUID NOT NULL,
    "intimacyId" UUID NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "inviterId" UUID NOT NULL,
    "inviteeId" UUID NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "relationships_intimacyId_key" ON "relationships"("intimacyId");
CREATE INDEX "relationships_inviterId_idx" ON "relationships"("inviterId");
CREATE INDEX "relationships_inviteeId_idx" ON "relationships"("inviteeId");
CREATE INDEX "relationships_status_idx" ON "relationships"("status");
CREATE INDEX "relationships_expiresAt_idx" ON "relationships"("expiresAt");

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_intimacyId_fkey" FOREIGN KEY ("intimacyId") REFERENCES "intimacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
