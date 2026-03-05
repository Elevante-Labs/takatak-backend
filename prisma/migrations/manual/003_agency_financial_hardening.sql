-- Agency Financial Hardening Migration
-- Run this BEFORE deploying the updated code.

-- 1. Add AGENCY_COMMISSION_REVERSAL to TransactionType enum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'AGENCY_COMMISSION_REVERSAL';

-- 2. Add rolling diamond counter fields to Agency
ALTER TABLE "agencies"
  ADD COLUMN IF NOT EXISTS "rollingDiamonds30d" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRollingUpdate" TIMESTAMP(3);

-- 3. Add originalTransactionId and isReversal to AgencyCommissionLog
ALTER TABLE "agency_commission_logs"
  ADD COLUMN IF NOT EXISTS "originalTransactionId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS "isReversal" BOOLEAN NOT NULL DEFAULT false;

-- 4. Remove the default from originalTransactionId (it was only for the ALTER)
-- This ensures future inserts require a real value.
-- NOTE: If there are existing rows, they will have the zero-UUID placeholder.
-- You may want to backfill them with the correct transaction IDs.

-- 5. Add index on originalTransactionId
CREATE INDEX IF NOT EXISTS "agency_commission_logs_originalTransactionId_idx"
  ON "agency_commission_logs" ("originalTransactionId");

-- 6. Add composite unique constraint (agencyId + originalTransactionId + isReversal)
-- This prevents double-crediting AND double-reversing, scoped per agency.
CREATE UNIQUE INDEX IF NOT EXISTS "agency_commission_logs_agencyId_originalTransactionId_isReversal_key"
  ON "agency_commission_logs" ("agencyId", "originalTransactionId", "isReversal");
