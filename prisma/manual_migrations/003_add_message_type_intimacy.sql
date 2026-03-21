-- Add MessageType enum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'EMOJI');

-- Add messageType and mediaUrl columns to messages table
ALTER TABLE "messages" ADD COLUMN "messageType" "MessageType" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "messages" ADD COLUMN "mediaUrl" TEXT;

-- Create intimacies table
CREATE TABLE "intimacies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intimacies_pkey" PRIMARY KEY ("id")
);

-- Add unique constraint and indexes
CREATE UNIQUE INDEX "intimacies_userId_hostId_key" ON "intimacies"("userId", "hostId");
CREATE INDEX "intimacies_userId_idx" ON "intimacies"("userId");
CREATE INDEX "intimacies_hostId_idx" ON "intimacies"("hostId");
CREATE INDEX "intimacies_level_idx" ON "intimacies"("level");

-- Add foreign keys
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
