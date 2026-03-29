import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class VipService {
  private readonly logger = new Logger(VipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Calculate discounted message cost based on VIP level.
   * Higher VIP = bigger discount.
   *
   * Rounding: Math.ceil ensures fractional coins always round UP,
   * meaning the platform never under-charges. This guarantees:
   * 1. No fractional coins (always integer)
   * 2. Minimum charge of 1 coin (floor clamp)
   * 3. Ledger deduction exactly matches the calculated cost
   *
   * Example: baseCost=10, VIP3, discountPercent=20
   *   totalDiscount = min(3*20/10, 50) = 6%
   *   discountedCost = ceil(10 * 0.94) = ceil(9.4) = 10
   * Example: baseCost=10, VIP5, discountPercent=20
   *   totalDiscount = min(5*20/10, 50) = 10%
   *   discountedCost = ceil(10 * 0.90) = 9
   */
  calculateDiscountedCost(baseCost: number, vipLevel: number): number {
    if (vipLevel <= 0) return baseCost;
    if (baseCost <= 0) return 0;

    const discountPercent = this.configService.get<number>('vip.discountPercent') || 20;

    // Each VIP level gives (discountPercent / 10)% discount, capped at 50%
    const totalDiscount = Math.min(
      (vipLevel * discountPercent) / 10,
      50,
    );

    // Math.ceil rounds UP — platform never under-charges
    const discountedCost = Math.ceil(baseCost * (1 - totalDiscount / 100));

    // Floor clamp: minimum charge of 1 coin to prevent free messages via VIP exploit
    return Math.max(1, discountedCost);
  }

  /**
   * Get VIP status for a user.
   */
  async getVipStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        vipLevel: true,
        vipExpiry: true,
      },
    });

    if (!user) {
      return { vipLevel: 0, isActive: false, expiry: null };
    }

    const isActive = user.vipExpiry ? new Date() < user.vipExpiry : false;

    return {
      vipLevel: user.vipLevel,
      isActive: user.vipLevel > 0 && isActive,
      expiry: user.vipExpiry,
      benefits: this.getVipBenefits(user.vipLevel),
    };
  }

  /**
   * Upgrade VIP level.
   */
  async upgradeVip(userId: string, level: number, durationDays: number = 30) {
    const expiry = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        vipLevel: level,
        vipExpiry: expiry,
      },
    });

    this.logger.log(
      `VIP upgrade: User ${userId} → Level ${level} (expires: ${expiry.toISOString()})`,
    );

    return {
      vipLevel: user.vipLevel,
      expiry: user.vipExpiry,
      benefits: this.getVipBenefits(level),
    };
  }

  /**
   * Check and expire VIP status.
   */
  async expireVipStatuses() {
    const result = await this.prisma.user.updateMany({
      where: {
        vipLevel: { gt: 0 },
        vipExpiry: { lt: new Date() },
      },
      data: {
        vipLevel: 0,
        vipExpiry: null,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired VIP status for ${result.count} users`);
    }

    return result;
  }

  /**
   * Get benefits for a VIP level.
   */
  private getVipBenefits(level: number) {
    const discountPercent = this.configService.get<number>('vip.discountPercent') || 20;
    const discount = Math.min((level * discountPercent) / 10, 50);

    return {
      level,
      messageDiscount: `${discount}%`,
      badge: level > 0 ? `VIP ${level}` : null,
      prioritySupport: level >= 3,
      exclusiveContent: level >= 5,
    };
  }
}
