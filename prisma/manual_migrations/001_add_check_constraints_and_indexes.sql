-- ============================================
-- CHECK CONSTRAINTS: Prevent negative balances at DB level
-- These are the last line of defense — application logic should
-- prevent this, but DB constraints guarantee it.
-- ============================================

-- Wallet: all balance columns must be non-negative
ALTER TABLE wallets
  ADD CONSTRAINT chk_wallet_gift_coins_non_negative CHECK ("giftCoins" >= 0),
  ADD CONSTRAINT chk_wallet_game_coins_non_negative CHECK ("gameCoins" >= 0),
  ADD CONSTRAINT chk_wallet_diamonds_non_negative CHECK (diamonds >= 0),
  ADD CONSTRAINT chk_wallet_promo_diamonds_non_negative CHECK ("promoDiamonds" >= 0);

-- Transaction: amounts must be non-negative
ALTER TABLE transactions
  ADD CONSTRAINT chk_transaction_coin_amount_non_negative CHECK ("coinAmount" >= 0),
  ADD CONSTRAINT chk_transaction_diamond_amount_non_negative CHECK ("diamondAmount" >= 0);

-- Message: costs must be non-negative
ALTER TABLE messages
  ADD CONSTRAINT chk_message_coin_cost_non_negative CHECK ("coinCost" >= 0),
  ADD CONSTRAINT chk_message_diamond_generated_non_negative CHECK ("diamondGenerated" >= 0);

-- User: VIP level must be non-negative
ALTER TABLE users
  ADD CONSTRAINT chk_user_vip_level_non_negative CHECK ("vipLevel" >= 0);

-- OTP: attempts must be non-negative
ALTER TABLE otps
  ADD CONSTRAINT chk_otp_attempts_non_negative CHECK (attempts >= 0);

-- Chat: user1 and user2 cannot be the same person
ALTER TABLE chats
  ADD CONSTRAINT chk_chat_no_self_chat CHECK ("user1Id" != "user2Id");

-- Chat: enforce canonical ordering so (A,B) and (B,A) are impossible
-- user1Id must always be lexicographically less than user2Id
ALTER TABLE chats
  ADD CONSTRAINT chk_chat_canonical_order CHECK ("user1Id" < "user2Id");


-- ============================================
-- ADDITIONAL INDEXES for high-volume scalability
-- ============================================

-- Messages: composite index for paginated chat message queries
-- Query pattern: WHERE chatId = ? ORDER BY createdAt DESC LIMIT ?
CREATE INDEX IF NOT EXISTS idx_messages_chat_created
  ON messages ("chatId", "createdAt" DESC);

-- Transactions: composite index for user transaction history
-- Query pattern: WHERE senderId = ? OR receiverId = ? ORDER BY createdAt DESC
CREATE INDEX IF NOT EXISTS idx_transactions_sender_created
  ON transactions ("senderId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_created
  ON transactions ("receiverId", "createdAt" DESC);

-- FraudFlags: unresolved flags query (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_fraud_flags_unresolved
  ON fraud_flags (resolved, "createdAt" DESC)
  WHERE resolved = false;

-- Referrals: lookup by referrer with reward status
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_reward
  ON referrals ("referrerId", "registrationRewardGiven");

-- Chat sessions: active sessions lookup
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
  ON chat_sessions ("userId", "chatId")
  WHERE "isActive" = true;

-- OTP: cleanup of expired OTPs (cron job target)
CREATE INDEX IF NOT EXISTS idx_otps_expired
  ON otps ("expiresAt")
  WHERE verified = false;

-- Users: active hosts listing
CREATE INDEX IF NOT EXISTS idx_users_active_hosts
  ON users (role, "isActive")
  WHERE role = 'HOST' AND "isActive" = true AND "deletedAt" IS NULL;
