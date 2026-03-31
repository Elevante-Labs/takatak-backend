/**
 * Gift Response DTO for Frontend Contract
 * Represents a gift with all frontend-relevant fields
 */
export class GiftResponseDto {
  id!: string;
  name!: string;
  description?: string;
  iconUrl!: string;
  animationUrl?: string;
  animationUrl_full?: string;
  coinCost!: number;
  diamondValue!: number;
  category!: string; // BASIC, PREMIUM, EVENT, VIP, SPONSORED
  rarity!: string; // COMMON, RARE, EPIC, LEGENDARY
  displayOrder!: number;
  isActive!: boolean;
  isLimited!: boolean;
  availableFrom?: Date;
  availableTill?: Date;
  minVipLevel!: number;
  comboMultiplier!: number;
  eventTag?: string;
  metadata?: Record<string, any>;
  createdAt!: Date;

  // Helper method to check if gift is currently available
  isCurrentlyAvailable(): boolean {
    if (!this.isActive) return false;
    if (!this.isLimited) return true;

    const now = new Date();
    if (this.availableFrom && now < new Date(this.availableFrom)) return false;
    if (this.availableTill && now > new Date(this.availableTill)) return false;

    return true;
  }

  // Helper method to check if user can send this gift
  canSend(userVipLevel: number): boolean {
    return this.isCurrentlyAvailable() && userVipLevel >= this.minVipLevel;
  }
}

/**
 * Gift List Response (with pagination meta)
 */
export class GiftListResponseDto {
  gifts!: GiftResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}
