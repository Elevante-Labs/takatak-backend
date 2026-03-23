-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'EMOJI');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'AGENCY_COMMISSION_REVERSAL';

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "lastRollingUpdate" TIMESTAMP(3),
ADD COLUMN     "rollingDiamonds30d" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "agency_commission_logs" ADD COLUMN     "isReversal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalTransactionId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "messageType" "MessageType" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "intimacies" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intimacies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intimacies_userId_idx" ON "intimacies"("userId");

-- CreateIndex
CREATE INDEX "intimacies_hostId_idx" ON "intimacies"("hostId");

-- CreateIndex
CREATE INDEX "intimacies_level_idx" ON "intimacies"("level");

-- CreateIndex
CREATE UNIQUE INDEX "intimacies_userId_hostId_key" ON "intimacies"("userId", "hostId");

-- CreateIndex
CREATE INDEX "agency_commission_logs_originalTransactionId_idx" ON "agency_commission_logs"("originalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_commission_logs_agencyId_originalTransactionId_isRev_key" ON "agency_commission_logs"("agencyId", "originalTransactionId", "isReversal");

-- AddForeignKey
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intimacies" ADD CONSTRAINT "intimacies_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
