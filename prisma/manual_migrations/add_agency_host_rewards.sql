-- Agency & Host Rewards System Migration
-- Run with: psql -U postgres -d takatak -f add_agency_host_rewards.sql

-- ============================================
-- New Enums
-- ============================================

-- Add AGENCY to Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AGENCY';

-- Add new transaction types
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'AGENCY_COMMISSION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HOST_SALARY_BONUS';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HOST_LIVE_BONUS';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HOST_NEW_REWARD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HOST_ORDINARY_REWARD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'HOST_SUPERSTAR_SALARY';

-- Create AgencyLevel enum
DO $$ BEGIN
  CREATE TYPE "AgencyLevel" AS ENUM ('D', 'C', 'B', 'A', 'S');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create HostLevel enum
DO $$ BEGIN
  CREATE TYPE "HostLevel" AS ENUM ('NONE', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create SuperstarTag enum
DO $$ BEGIN
  CREATE TYPE "SuperstarTag" AS ENUM ('TALENT', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Agency Tables
-- ============================================

CREATE TABLE IF NOT EXISTS "agencies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL,
  "parentAgencyId" UUID,
  "name" TEXT NOT NULL,
  "level" "AgencyLevel" NOT NULL DEFAULT 'D',
  "isBanned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agencies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agencies_ownerId_key" UNIQUE ("ownerId")
);

CREATE INDEX IF NOT EXISTS "agencies_ownerId_idx" ON "agencies"("ownerId");
CREATE INDEX IF NOT EXISTS "agencies_parentAgencyId_idx" ON "agencies"("parentAgencyId");
CREATE INDEX IF NOT EXISTS "agencies_level_idx" ON "agencies"("level");

ALTER TABLE "agencies" ADD CONSTRAINT "agencies_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_parentAgencyId_fkey"
  FOREIGN KEY ("parentAgencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- Agency Commission Log
-- ============================================

CREATE TABLE IF NOT EXISTS "agency_commission_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS "agency_commission_logs_agencyId_idx" ON "agency_commission_logs"("agencyId");
CREATE INDEX IF NOT EXISTS "agency_commission_logs_sourceAgencyId_idx" ON "agency_commission_logs"("sourceAgencyId");
CREATE INDEX IF NOT EXISTS "agency_commission_logs_createdAt_idx" ON "agency_commission_logs"("createdAt");

ALTER TABLE "agency_commission_logs" ADD CONSTRAINT "agency_commission_logs_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Host Profile
-- ============================================

CREATE TABLE IF NOT EXISTS "host_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

  CONSTRAINT "host_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "host_profiles_userId_key" UNIQUE ("userId")
);

CREATE INDEX IF NOT EXISTS "host_profiles_userId_idx" ON "host_profiles"("userId");
CREATE INDEX IF NOT EXISTS "host_profiles_agencyId_idx" ON "host_profiles"("agencyId");
CREATE INDEX IF NOT EXISTS "host_profiles_hostLevel_idx" ON "host_profiles"("hostLevel");

ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- Host Daily Stats
-- ============================================

CREATE TABLE IF NOT EXISTS "host_daily_stats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

  CONSTRAINT "host_daily_stats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "host_daily_stats_hostProfileId_date_key" UNIQUE ("hostProfileId", "date")
);

CREATE INDEX IF NOT EXISTS "host_daily_stats_hostProfileId_idx" ON "host_daily_stats"("hostProfileId");
CREATE INDEX IF NOT EXISTS "host_daily_stats_date_idx" ON "host_daily_stats"("date");

ALTER TABLE "host_daily_stats" ADD CONSTRAINT "host_daily_stats_hostProfileId_fkey"
  FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Host Weekly Stats
-- ============================================

CREATE TABLE IF NOT EXISTS "host_weekly_stats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hostProfileId" UUID NOT NULL,
  "weekStart" DATE NOT NULL,
  "diamondsReceived" INTEGER NOT NULL DEFAULT 0,
  "totalLiveMinutes" INTEGER NOT NULL DEFAULT 0,
  "bonusClaimed" BOOLEAN NOT NULL DEFAULT false,
  "bonusDiamonds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "host_weekly_stats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "host_weekly_stats_hostProfileId_weekStart_key" UNIQUE ("hostProfileId", "weekStart")
);

CREATE INDEX IF NOT EXISTS "host_weekly_stats_hostProfileId_idx" ON "host_weekly_stats"("hostProfileId");
CREATE INDEX IF NOT EXISTS "host_weekly_stats_weekStart_idx" ON "host_weekly_stats"("weekStart");

ALTER TABLE "host_weekly_stats" ADD CONSTRAINT "host_weekly_stats_hostProfileId_fkey"
  FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Superstar Records
-- ============================================

CREATE TABLE IF NOT EXISTS "superstar_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

  CONSTRAINT "superstar_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "superstar_records_hostProfileId_month_key" UNIQUE ("hostProfileId", "month")
);

CREATE INDEX IF NOT EXISTS "superstar_records_hostProfileId_idx" ON "superstar_records"("hostProfileId");
CREATE INDEX IF NOT EXISTS "superstar_records_month_idx" ON "superstar_records"("month");

ALTER TABLE "superstar_records" ADD CONSTRAINT "superstar_records_hostProfileId_fkey"
  FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Host Reward Claims
-- ============================================

CREATE TABLE IF NOT EXISTS "host_reward_claims" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hostProfileId" UUID NOT NULL,
  "rewardType" TEXT NOT NULL,
  "diamondsAwarded" INTEGER NOT NULL DEFAULT 0,
  "date" DATE NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "host_reward_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "host_reward_claims_hostProfileId_idx" ON "host_reward_claims"("hostProfileId");
CREATE INDEX IF NOT EXISTS "host_reward_claims_rewardType_idx" ON "host_reward_claims"("rewardType");
CREATE INDEX IF NOT EXISTS "host_reward_claims_date_idx" ON "host_reward_claims"("date");

ALTER TABLE "host_reward_claims" ADD CONSTRAINT "host_reward_claims_hostProfileId_fkey"
  FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
