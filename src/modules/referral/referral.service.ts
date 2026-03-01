import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Process referral on new user registration.
   * referralCode = referrer's user ID (or phone).
   */
  async processRegistrationReferral(
    referredUserId: string,
    referralCode: string,
    deviceFingerprint?: string,
  ) {
    // Find referrer
    const referrer = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: referralCode }, { phone: referralCode }],
        deletedAt: null,
      },
    });

    if (!referrer) {
      throw new NotFoundException('Invalid referral code');
    }

    // Self-referral prevention
    if (referrer.id === referredUserId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    // Device fingerprint abuse prevention
    if (deviceFingerprint && referrer.deviceFingerprint === deviceFingerprint) {
      this.logger.warn(
        `Referral abuse detected: same device fingerprint ${deviceFingerprint}`,
      );
      throw new BadRequestException('Referral abuse detected');
    }

    // Check if referral already exists
    const existingReferral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });

    if (existingReferral) {
      throw new ConflictException('User already has a referral');
    }

    // Check for referral loop — deep chain detection (A→B→C→A)
    const visited = new Set<string>([referredUserId]);
    let currentId = referrer.id;
    const maxDepth = 10; // prevent infinite traversal
    let depth = 0;

    while (currentId && depth < maxDepth) {
      if (visited.has(currentId)) {
        throw new BadRequestException('Circular referral chain detected');
      }
      visited.add(currentId);
      const upstream = await this.prisma.referral.findUnique({
        where: { referredId: currentId },
        select: { referrerId: true },
      });
      currentId = upstream?.referrerId ?? '';
      depth++;
    }

    // Create referral record
    const referral = await this.prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredId: referredUserId,
      },
    });

    // Award registration reward to referrer
    const rewardAmount = this.configService.get<number>('referral.rewardCoins') || 50;

    await this.walletService.awardReferralBonus(
      referrer.id,
      rewardAmount,
      `Referral reward: new user registration (${referredUserId})`,
    );

    // Mark reward as given
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { registrationRewardGiven: true },
    });

    this.logger.log(
      `Referral processed: ${referrer.id} referred ${referredUserId} (+${rewardAmount} coins)`,
    );

    return {
      referralId: referral.id,
      referrerId: referrer.id,
      rewardCoins: rewardAmount,
    };
  }

  /**
   * Award first-chat referral bonus.
   * Called when referred user sends their first chat message.
   */
  async processFirstChatReferral(referredUserId: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });

    if (!referral) {
      return null; // No referral, skip
    }

    if (referral.firstChatRewardGiven) {
      return null; // Already rewarded
    }

    const rewardAmount = this.configService.get<number>('referral.firstChatReward') || 25;

    await this.walletService.awardReferralBonus(
      referral.referrerId,
      rewardAmount,
      `Referral reward: referred user first chat (${referredUserId})`,
    );

    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { firstChatRewardGiven: true },
    });

    this.logger.log(
      `First-chat referral reward: ${referral.referrerId} earned ${rewardAmount} coins`,
    );

    return { rewardCoins: rewardAmount };
  }

  /**
   * Get referral stats for a user.
   */
  async getReferralStats(userId: string) {
    const [totalReferrals, rewardedReferrals] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referral.count({
        where: { referrerId: userId, registrationRewardGiven: true },
      }),
    ]);

    return {
      totalReferrals,
      rewardedReferrals,
      referralCode: userId, // User ID serves as referral code
    };
  }

  /**
   * Get referral history for a user.
   */
  async getReferralHistory(userId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = { referrerId: userId };

    const [referrals, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          referred: {
            select: { id: true, username: true, createdAt: true },
          },
        },
      }),
      this.prisma.referral.count({ where }),
    ]);

    return buildPaginatedResult(referrals, total, params);
  }
}
