/**
 * Agency commission tiers based on total diamond income
 * in the recent 30 days + current day across all hosts
 * under the agency and its sub-agencies.
 *
 * Cash-out rate: 10,000 diamonds = 1 USD
 */
export interface AgencyTier {
  level: string;
  minDiamonds: number;
  maxDiamonds: number; // Infinity for top tier
  commissionRate: number; // e.g. 0.04 = 4%
}

export const AGENCY_TIERS: AgencyTier[] = [
  { level: 'D', minDiamonds: 0, maxDiamonds: 999_999, commissionRate: 0.04 },
  { level: 'C', minDiamonds: 1_000_000, maxDiamonds: 4_999_999, commissionRate: 0.08 },
  { level: 'B', minDiamonds: 5_000_000, maxDiamonds: 9_999_999, commissionRate: 0.12 },
  { level: 'A', minDiamonds: 10_000_000, maxDiamonds: 29_999_999, commissionRate: 0.16 },
  { level: 'S', minDiamonds: 30_000_000, maxDiamonds: Infinity, commissionRate: 0.20 },
];

/**
 * Diamonds to USD conversion rate for agencies
 */
export const AGENCY_DIAMOND_TO_USD_RATE = 10_000; // 10,000 diamonds = 1 USD

/**
 * Get the agency tier for a given diamond amount
 */
export function getAgencyTier(totalDiamonds: number): AgencyTier {
  for (let i = AGENCY_TIERS.length - 1; i >= 0; i--) {
    if (totalDiamonds >= AGENCY_TIERS[i].minDiamonds) {
      return AGENCY_TIERS[i];
    }
  }
  return AGENCY_TIERS[0];
}

/**
 * Get commission rate for a given diamond amount
 */
export function getCommissionRate(totalDiamonds: number): number {
  return getAgencyTier(totalDiamonds).commissionRate;
}
