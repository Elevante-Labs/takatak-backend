-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'HOST', 'AGENCY', 'ADMIN');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('RECHARGE', 'CHAT_PAYMENT', 'REFERRAL_REWARD', 'DAILY_BONUS', 'PROMO', 'COIN_TO_DIAMOND', 'DIAMOND_TO_COIN', 'WITHDRAWAL', 'AGENCY_COMMISSION', 'HOST_SALARY_BONUS', 'HOST_LIVE_BONUS', 'HOST_NEW_REWARD', 'HOST_ORDINARY_REWARD', 'HOST_SUPERSTAR_SALARY');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FraudFlagType" AS ENUM ('MULTI_ACCOUNT', 'SELF_CHAT', 'RATE_ABUSE', 'DEVICE_ANOMALY', 'SUSPICIOUS_PATTERN');

-- CreateEnum
CREATE TYPE "AgencyLevel" AS ENUM ('D', 'C', 'B', 'A', 'S');

-- CreateEnum
CREATE TYPE "HostLevel" AS ENUM ('NONE', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS');

-- CreateEnum
CREATE TYPE "SuperstarTag" AS ENUM ('TALENT', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "username" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "vipLevel" INTEGER NOT NULL DEFAULT 0,
    "vipExpiry" TIMESTAMP(3),
    "country" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "deviceFingerprint" TEXT,
    "lastLoginIp" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "giftCoins" INTEGER NOT NULL DEFAULT 0,
    "gameCoins" INTEGER NOT NULL DEFAULT 0,
    "diamonds" INTEGER NOT NULL DEFAULT 0,
    "promoDiamonds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "type" "TransactionType" NOT NULL,
    "senderId" UUID,
    "receiverId" UUID,
    "coinAmount" INTEGER NOT NULL DEFAULT 0,
    "diamondAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "user1Id" UUID NOT NULL,
    "user2Id" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "coinCost" INTEGER NOT NULL DEFAULT 0,
    "diamondGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "socketId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrerId" UUID NOT NULL,
    "referredId" UUID NOT NULL,
    "registrationRewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "firstChatRewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "FraudFlagType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "deviceFingerprint" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" UUID NOT NULL,
    "followerId" UUID NOT NULL,
    "followeeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "diamondAmount" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "parentAgencyId" UUID,
    "name" TEXT NOT NULL,
    "level" "AgencyLevel" NOT NULL DEFAULT 'D',
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_commission_logs" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "sourceAgencyId" UUID,
    "hostId" UUID,
    "giftDiamonds" INTEGER NOT NULL DEFAULT 0,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "subAgencyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveRate" DOUBLE PRECISION NOT NULL,
    "diamondsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_commission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "agencyId" UUID,
    "hostLevel" "HostLevel" NOT NULL DEFAULT 'NONE',
    "gender" TEXT,
    "isSuperstar" BOOLEAN NOT NULL DEFAULT false,
    "superstarTag" "SuperstarTag",
    "registeredAsHostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_daily_stats" (
    "id" UUID NOT NULL,
    "hostProfileId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "diamondsReceived" INTEGER NOT NULL DEFAULT 0,
    "liveMinutes" INTEGER NOT NULL DEFAULT 0,
    "bonusClaimed" BOOLEAN NOT NULL DEFAULT false,
    "bonusDiamonds" INTEGER NOT NULL DEFAULT 0,
    "salaryClaimed" BOOLEAN NOT NULL DEFAULT false,
    "salaryDiamonds" INTEGER NOT NULL DEFAULT 0,
    "newHostRewardClaimed" BOOLEAN NOT NULL DEFAULT false,
    "newHostRewardDiamonds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_weekly_stats" (
    "id" UUID NOT NULL,
    "hostProfileId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "diamondsReceived" INTEGER NOT NULL DEFAULT 0,
    "totalLiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "bonusClaimed" BOOLEAN NOT NULL DEFAULT false,
    "bonusDiamonds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_weekly_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "superstar_records" (
    "id" UUID NOT NULL,
    "hostProfileId" UUID NOT NULL,
    "tag" "SuperstarTag" NOT NULL,
    "month" DATE NOT NULL,
    "timeTargetHours" INTEGER NOT NULL DEFAULT 30,
    "diamondTarget" INTEGER NOT NULL,
    "totalLiveHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDiamonds" INTEGER NOT NULL DEFAULT 0,
    "targetMet" BOOLEAN NOT NULL DEFAULT false,
    "fixedSalaryPaid" BOOLEAN NOT NULL DEFAULT false,
    "extraBonusUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "superstar_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_reward_claims" (
    "id" UUID NOT NULL,
    "hostProfileId" UUID NOT NULL,
    "rewardType" TEXT NOT NULL,
    "diamondsAwarded" INTEGER NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_reward_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_deviceFingerprint_idx" ON "users"("deviceFingerprint");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "otps_phone_code_idx" ON "otps"("phone", "code");

-- CreateIndex
CREATE INDEX "otps_expiresAt_idx" ON "otps"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "transactions_senderId_idx" ON "transactions"("senderId");

-- CreateIndex
CREATE INDEX "transactions_receiverId_idx" ON "transactions"("receiverId");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "chats_user1Id_idx" ON "chats"("user1Id");

-- CreateIndex
CREATE INDEX "chats_user2Id_idx" ON "chats"("user2Id");

-- CreateIndex
CREATE INDEX "chats_createdAt_idx" ON "chats"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chats_user1Id_user2Id_key" ON "chats"("user1Id", "user2Id");

-- CreateIndex
CREATE INDEX "messages_chatId_idx" ON "messages"("chatId");

-- CreateIndex
CREATE INDEX "messages_senderId_idx" ON "messages"("senderId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "chat_sessions_userId_idx" ON "chat_sessions"("userId");

-- CreateIndex
CREATE INDEX "chat_sessions_chatId_idx" ON "chat_sessions"("chatId");

-- CreateIndex
CREATE INDEX "chat_sessions_socketId_idx" ON "chat_sessions"("socketId");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredId_key" ON "referrals"("referredId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_referredId_idx" ON "referrals"("referredId");

-- CreateIndex
CREATE INDEX "fraud_flags_userId_idx" ON "fraud_flags"("userId");

-- CreateIndex
CREATE INDEX "fraud_flags_type_idx" ON "fraud_flags"("type");

-- CreateIndex
CREATE INDEX "fraud_flags_createdAt_idx" ON "fraud_flags"("createdAt");

-- CreateIndex
CREATE INDEX "follows_followerId_idx" ON "follows"("followerId");

-- CreateIndex
CREATE INDEX "follows_followeeId_idx" ON "follows"("followeeId");

-- CreateIndex
CREATE UNIQUE INDEX "follows_followerId_followeeId_key" ON "follows"("followerId", "followeeId");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_idx" ON "withdrawal_requests"("userId");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");

-- CreateIndex
CREATE INDEX "withdrawal_requests_createdAt_idx" ON "withdrawal_requests"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_ownerId_key" ON "agencies"("ownerId");

-- CreateIndex
CREATE INDEX "agencies_ownerId_idx" ON "agencies"("ownerId");

-- CreateIndex
CREATE INDEX "agencies_parentAgencyId_idx" ON "agencies"("parentAgencyId");

-- CreateIndex
CREATE INDEX "agencies_level_idx" ON "agencies"("level");

-- CreateIndex
CREATE INDEX "agency_commission_logs_agencyId_idx" ON "agency_commission_logs"("agencyId");

-- CreateIndex
CREATE INDEX "agency_commission_logs_sourceAgencyId_idx" ON "agency_commission_logs"("sourceAgencyId");

-- CreateIndex
CREATE INDEX "agency_commission_logs_createdAt_idx" ON "agency_commission_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "host_profiles_userId_key" ON "host_profiles"("userId");

-- CreateIndex
CREATE INDEX "host_profiles_userId_idx" ON "host_profiles"("userId");

-- CreateIndex
CREATE INDEX "host_profiles_agencyId_idx" ON "host_profiles"("agencyId");

-- CreateIndex
CREATE INDEX "host_profiles_hostLevel_idx" ON "host_profiles"("hostLevel");

-- CreateIndex
CREATE INDEX "host_daily_stats_hostProfileId_idx" ON "host_daily_stats"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_daily_stats_date_idx" ON "host_daily_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "host_daily_stats_hostProfileId_date_key" ON "host_daily_stats"("hostProfileId", "date");

-- CreateIndex
CREATE INDEX "host_weekly_stats_hostProfileId_idx" ON "host_weekly_stats"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_weekly_stats_weekStart_idx" ON "host_weekly_stats"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "host_weekly_stats_hostProfileId_weekStart_key" ON "host_weekly_stats"("hostProfileId", "weekStart");

-- CreateIndex
CREATE INDEX "superstar_records_hostProfileId_idx" ON "superstar_records"("hostProfileId");

-- CreateIndex
CREATE INDEX "superstar_records_month_idx" ON "superstar_records"("month");

-- CreateIndex
CREATE UNIQUE INDEX "superstar_records_hostProfileId_month_key" ON "superstar_records"("hostProfileId", "month");

-- CreateIndex
CREATE INDEX "host_reward_claims_hostProfileId_idx" ON "host_reward_claims"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_reward_claims_rewardType_idx" ON "host_reward_claims"("rewardType");

-- CreateIndex
CREATE INDEX "host_reward_claims_date_idx" ON "host_reward_claims"("date");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "otps" ADD CONSTRAINT "otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followeeId_fkey" FOREIGN KEY ("followeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_parentAgencyId_fkey" FOREIGN KEY ("parentAgencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_commission_logs" ADD CONSTRAINT "agency_commission_logs_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_daily_stats" ADD CONSTRAINT "host_daily_stats_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_weekly_stats" ADD CONSTRAINT "host_weekly_stats_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "superstar_records" ADD CONSTRAINT "superstar_records_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_reward_claims" ADD CONSTRAINT "host_reward_claims_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
