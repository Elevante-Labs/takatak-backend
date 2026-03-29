/**
 * Host Video Daily Salary Tiers
 *
 * Host must hit the diamond target + 2 hours of video live
 * to earn the bonus. Total daily income = diamondTarget + bonus.
 *
 * Cash-out rate: 10,000 diamonds = 1 USD
 * Host gets salary in INR at rate of 81 INR = 1 USD
 */
export interface HostSalaryTier {
  level: string;
  diamondTarget: number;
  requiredLiveHours: number;
  bonusDiamonds: number;
  totalDailyIncome: number;   // diamondTarget + bonus
  salaryUsd: number;          // totalDailyIncome / 10,000
}

export const HOST_SALARY_TIERS: HostSalaryTier[] = [
  { level: 'F', diamondTarget: 40_000, requiredLiveHours: 2, bonusDiamonds: 10_000, totalDailyIncome: 50_000, salaryUsd: 5 },
  { level: 'E', diamondTarget: 80_000, requiredLiveHours: 2, bonusDiamonds: 20_000, totalDailyIncome: 100_000, salaryUsd: 10 },
  { level: 'D', diamondTarget: 200_000, requiredLiveHours: 2, bonusDiamonds: 50_000, totalDailyIncome: 250_000, salaryUsd: 25 },
  { level: 'C', diamondTarget: 450_000, requiredLiveHours: 2, bonusDiamonds: 110_000, totalDailyIncome: 560_000, salaryUsd: 56 },
  { level: 'B', diamondTarget: 800_000, requiredLiveHours: 2, bonusDiamonds: 200_000, totalDailyIncome: 1_000_000, salaryUsd: 100 },
  { level: 'A', diamondTarget: 2_000_000, requiredLiveHours: 2, bonusDiamonds: 500_000, totalDailyIncome: 2_500_000, salaryUsd: 250 },
  { level: 'S', diamondTarget: 3_500_000, requiredLiveHours: 2, bonusDiamonds: 850_000, totalDailyIncome: 4_350_000, salaryUsd: 435 },
  { level: 'SS', diamondTarget: 5_000_000, requiredLiveHours: 2, bonusDiamonds: 1_250_000, totalDailyIncome: 6_250_000, salaryUsd: 625 },
];

/**
 * New female host reward
 * For female users newly registered as host within 7 days
 */
export const NEW_FEMALE_HOST_REWARD = {
  dailyDiamonds: 10_000,
  requiredLiveHours: 2,
  eligibleDays: 7, // within 7 days of registration
};

/**
 * Ordinary female host reward
 * For female users registered as host after 7 days,
 * and diamond income < 40,000
 */
export const ORDINARY_FEMALE_HOST_REWARD = {
  dailyDiamonds: 2_000,
  requiredLiveHours: 2,
  maxDiamondIncome: 40_000, // only if income < this
};

/**
 * Superstar host tags and their targets
 *
 * Superstar hosts:
 * - Must broadcast between 9pm-12pm every day, total 25 days
 * - Must have lights, microphone, acoustic equipment
 * - Must attend online audition
 * - Fixed salary released on 1st of next month by diamonds
 * - Agency owner gets 10 USD bonus per superstar host that completes target
 */
export interface SuperstarTier {
  tag: string;
  timeTargetHours: number;
  diamondTarget: number;
  extraBonusUsd: number;
}

export const SUPERSTAR_TIERS: SuperstarTier[] = [
  { tag: 'TALENT', timeTargetHours: 30, diamondTarget: 1_000_000, extraBonusUsd: 10 },
  { tag: 'H', timeTargetHours: 30, diamondTarget: 3_000_000, extraBonusUsd: 30 },
  { tag: 'G', timeTargetHours: 30, diamondTarget: 5_000_000, extraBonusUsd: 50 },
  { tag: 'F', timeTargetHours: 30, diamondTarget: 7_000_000, extraBonusUsd: 70 },
  { tag: 'E', timeTargetHours: 30, diamondTarget: 10_000_000, extraBonusUsd: 100 },
  { tag: 'D', timeTargetHours: 30, diamondTarget: 18_000_000, extraBonusUsd: 180 },
  { tag: 'C', timeTargetHours: 30, diamondTarget: 25_000_000, extraBonusUsd: 250 },
  { tag: 'B', timeTargetHours: 30, diamondTarget: 45_000_000, extraBonusUsd: 450 },
  { tag: 'A', timeTargetHours: 0, diamondTarget: 70_000_000, extraBonusUsd: 700 },
  { tag: 'S', timeTargetHours: 0, diamondTarget: 100_000_000, extraBonusUsd: 1_000 },
  { tag: 'SS', timeTargetHours: 0, diamondTarget: 100_000_000, extraBonusUsd: 1_000 },
];

/**
 * Conversion constants
 */
export const HOST_DIAMOND_TO_USD_RATE = 10_000; // 10,000 diamonds = 1 USD
export const USD_TO_INR_RATE = 81;
export const AGENCY_BONUS_PER_SUPERSTAR_USD = 10;

/**
 * Withdrawal rules
 * - Opens every Monday, paid before Thursday (weekly)
 * - Total amount must be >= $20 and integer multiple of $10
 */
export const HOST_WITHDRAWAL_RULES = {
  minAmountUsd: 20,
  multipleOfUsd: 10,
};

/**
 * Get the highest salary tier a host qualifies for
 * based on their daily diamonds received and live hours.
 */
export function getHostSalaryTier(
  diamondsReceived: number,
  liveHours: number,
): HostSalaryTier | null {
  // Find the highest tier where the host meets both targets
  for (let i = HOST_SALARY_TIERS.length - 1; i >= 0; i--) {
    const tier = HOST_SALARY_TIERS[i];
    if (
      diamondsReceived >= tier.diamondTarget &&
      liveHours >= tier.requiredLiveHours
    ) {
      return tier;
    }
  }
  return null;
}

/**
 * Get superstar tier by tag
 */
export function getSuperstarTier(tag: string): SuperstarTier | undefined {
  return SUPERSTAR_TIERS.find((t) => t.tag === tag);
}
