-- CreateEnum for GiftCategory
CREATE TYPE "GiftCategory" AS ENUM ('BASIC', 'PREMIUM', 'EVENT', 'VIP', 'SPONSORED');

-- CreateEnum for GiftRarity
CREATE TYPE "GiftRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateTable gifts
CREATE TABLE "gifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT NOT NULL,
    "animationUrl" TEXT,
    "animationUrl_full" TEXT,
    "coinCost" INTEGER NOT NULL,
    "diamondValue" INTEGER NOT NULL,
    "category" "GiftCategory" NOT NULL DEFAULT 'BASIC',
    "rarity" "GiftRarity" NOT NULL DEFAULT 'COMMON',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "availableFrom" TIMESTAMP(3),
    "availableTill" TIMESTAMP(3),
    "minVipLevel" INTEGER NOT NULL DEFAULT 0,
    "comboMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "eventTag" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for gifts
CREATE UNIQUE INDEX "gifts_name_key" ON "gifts"("name");
CREATE INDEX "gifts_isActive_idx" ON "gifts"("isActive");
CREATE INDEX "gifts_category_idx" ON "gifts"("category");
CREATE INDEX "gifts_rarity_idx" ON "gifts"("rarity");
CREATE INDEX "gifts_availableTill_idx" ON "gifts"("availableTill");
CREATE INDEX "gifts_createdAt_idx" ON "gifts"("createdAt");

-- CreateTable gift_analytics
CREATE TABLE "gift_analytics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "giftId" UUID NOT NULL,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalDiamondsEarned" INTEGER NOT NULL DEFAULT 0,
    "uniqueSenders" INTEGER NOT NULL DEFAULT 0,
    "uniqueReceivers" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for gift_analytics
CREATE UNIQUE INDEX "gift_analytics_giftId_key" ON "gift_analytics"("giftId");
CREATE INDEX "gift_analytics_giftId_idx" ON "gift_analytics"("giftId");
CREATE INDEX "gift_analytics_totalSent_idx" ON "gift_analytics"("totalSent");
CREATE INDEX "gift_analytics_popularityScore_idx" ON "gift_analytics"("popularityScore");

-- CreateTable gift_transactions
CREATE TABLE "gift_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transactionId" UUID NOT NULL,
    "giftId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "receiverId" UUID NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "diamondValue" INTEGER NOT NULL,
    "comboCount" INTEGER NOT NULL DEFAULT 1,
    "appliedMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for gift_transactions
CREATE UNIQUE INDEX "gift_transactions_transactionId_key" ON "gift_transactions"("transactionId");
CREATE INDEX "gift_transactions_giftId_idx" ON "gift_transactions"("giftId");
CREATE INDEX "gift_transactions_senderId_idx" ON "gift_transactions"("senderId");
CREATE INDEX "gift_transactions_receiverId_idx" ON "gift_transactions"("receiverId");
CREATE INDEX "gift_transactions_createdAt_idx" ON "gift_transactions"("createdAt");

-- AddForeignKey for gift_analytics
ALTER TABLE "gift_analytics" ADD CONSTRAINT "gift_analytics_giftId_fkey" 
FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
