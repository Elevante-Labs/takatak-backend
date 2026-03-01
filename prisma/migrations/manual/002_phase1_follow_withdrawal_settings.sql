-- Phase 1 Migration: Follow, WithdrawalRequest, SystemSettings + Schema Updates
-- Run this AFTER running `prisma migrate dev` for the schema changes

-- ==================================================
-- 1. Add idempotencyKey unique index on transactions
-- ==================================================
-- (Handled by Prisma migration, but ensure it's present)

-- ==================================================
-- 2. CHECK constraints for new models
-- ==================================================

-- WithdrawalRequest: diamond amount must be positive
ALTER TABLE withdrawal_requests
  ADD CONSTRAINT chk_withdrawal_diamond_amount
  CHECK ("diamondAmount" > 0);

-- Follow: cannot follow yourself
ALTER TABLE follows
  ADD CONSTRAINT chk_follow_not_self
  CHECK ("followerId" <> "followeeId");

-- ==================================================
-- 3. Seed default system settings
-- ==================================================

INSERT INTO system_settings (id, key, value, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'DIAMOND_TO_COIN_RATIO', '10', NOW(), NOW()),
  (gen_random_uuid(), 'MESSAGE_MAX_LENGTH', '300', NOW(), NOW()),
  (gen_random_uuid(), 'VERIFIED_BOOST_MULTIPLIER', '1.5', NOW(), NOW()),
  (gen_random_uuid(), 'MIN_WITHDRAWAL_DIAMONDS', '100', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- ==================================================
-- 4. Additional indexes for Phase 1 queries
-- ==================================================

-- Host dashboard: count diamonds earned today
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_receiver_type_created
  ON transactions ("receiverId", type, "createdAt");

-- Withdrawal pending aggregation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_withdrawal_user_status
  ON withdrawal_requests ("userId", status);

-- Follow lookup for free-chat check
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_pair
  ON follows ("followerId", "followeeId");
