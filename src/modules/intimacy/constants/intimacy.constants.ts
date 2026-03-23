/**
 * Intimacy Level Thresholds (exponential scaling)
 */
export const LEVEL_THRESHOLDS: { level: number; minScore: number }[] = [
  { level: 0, minScore: 0 },
  { level: 1, minScore: 100 },
  { level: 2, minScore: 300 },
  { level: 3, minScore: 800 },
  { level: 4, minScore: 2000 },
  { level: 5, minScore: 5000 },
  { level: 6, minScore: 12000 },
  { level: 7, minScore: 28000 },
  { level: 8, minScore: 65000 },
  { level: 9, minScore: 150000 },
  { level: 10, minScore: 350000 },
];

export const MAX_LEVEL = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].level;

/**
 * Daily chat round cap
 */
export const DAILY_CHAT_ROUND_CAP = 30;

/**
 * Chat XP per round
 */
export const CHAT_XP_PER_ROUND = 1;

/**
 * Reply speed scoring thresholds (milliseconds → XP)
 */
export const REPLY_SPEED_TIERS = [
  { maxMs: 5_000, xp: 10 },     // <5 seconds
  { maxMs: 15_000, xp: 7 },     // 5–15 seconds
  { maxMs: 60_000, xp: 4 },     // 15–60 seconds
  { maxMs: Infinity, xp: 1 },   // >60 seconds
];

/**
 * Freshness multiplier based on days since last interaction
 */
export const FRESHNESS_TIERS = [
  { maxDays: 2, multiplier: 2.0 },
  { maxDays: 7, multiplier: 1.5 },
  { maxDays: 30, multiplier: 1.0 },
  { maxDays: Infinity, multiplier: 0.5 },
];

/**
 * Feature gating: minimum intimacy level required per feature
 */
export const FEATURE_LEVEL_MAP: Record<string, number> = {
  call: 1,
  voice: 2,
  video: 3,
  private_album: 4,
  exclusive_sticker: 5,
  relationship: 6,
};

/**
 * Relationship constraints
 */
export const MAX_COUPLE_RELATIONSHIPS = 1;
export const MAX_BEST_FRIEND_RELATIONSHIPS = 5;

/**
 * Decay configuration
 */
export const DECAY_POINTS_PER_DAY = 10;
export const RELATIONSHIP_GIFT_EXPIRY_DAYS = 7;

/**
 * Reactivation cost multiplier per level
 * Total cost = level * REACTIVATION_COST_PER_LEVEL (in coins)
 */
export const REACTIVATION_COST_PER_LEVEL = 500;
