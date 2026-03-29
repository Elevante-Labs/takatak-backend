import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TransactionType, TransactionStatus } from '@prisma/client';
import {
  HOST_SALARY_TIERS,
  HOST_DIAMOND_TO_USD_RATE,
  USD_TO_INR_RATE,
  NEW_FEMALE_HOST_REWARD,
  ORDINARY_FEMALE_HOST_REWARD,
  SUPERSTAR_TIERS,
  AGENCY_BONUS_PER_SUPERSTAR_USD,
  HOST_WITHDRAWAL_RULES,
  getHostSalaryTier,
  getSuperstarTier,
} from './constants/host-tiers.constant';

@Injectable()
export class HostRewardService {
  private readonly logger = new Logger(HostRewardService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────
  // Host Profile Management
  // ──────────────────────────────────────────

  /**
   * Create or get host profile
   */
  async ensureHostProfile(userId: string) {
    let profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      // Verify user exists and is HOST role
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) throw new NotFoundException('User not found');
      if (user.role !== 'HOST') {
        throw new ForbiddenException('User must be a HOST');
      }

      profile = await this.prisma.hostProfile.create({
        data: { userId },
      });
    }

    return profile;
  }

  /**
   * Get or create today's daily stat for a host
   */
  async getOrCreateDailyStat(hostProfileId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let stat = await this.prisma.hostDailyStat.findUnique({
      where: {
        hostProfileId_date: {
          hostProfileId,
          date: today,
        },
      },
    });

    if (!stat) {
      stat = await this.prisma.hostDailyStat.create({
        data: {
          hostProfileId,
          date: today,
        },
      });
    }

    return stat;
  }

  // ──────────────────────────────────────────
  // Record diamond income from gifts
  // ──────────────────────────────────────────

  /**
   * Called when a host receives diamonds from a gift (Live, Party, Chat).
   * Updates daily and weekly stats.
   * Does NOT include platform rewards (ranking, tasks).
   */
  async recordGiftIncome(hostUserId: string, diamonds: number): Promise<void> {
    if (diamonds <= 0) return;

    const profile = await this.ensureHostProfile(hostUserId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Update daily stat
    await this.prisma.hostDailyStat.upsert({
      where: {
        hostProfileId_date: {
          hostProfileId: profile.id,
          date: today,
        },
      },
      update: {
        diamondsReceived: { increment: diamonds },
      },
      create: {
        hostProfileId: profile.id,
        date: today,
        diamondsReceived: diamonds,
      },
    });

    // Update weekly stat (week starts Monday)
    const weekStart = this.getWeekStart(today);
    await this.prisma.hostWeeklyStat.upsert({
      where: {
        hostProfileId_weekStart: {
          hostProfileId: profile.id,
          weekStart,
        },
      },
      update: {
        diamondsReceived: { increment: diamonds },
      },
      create: {
        hostProfileId: profile.id,
        weekStart,
        diamondsReceived: diamonds,
      },
    });
  }

  /**
   * Record live streaming minutes for a host
   */
  async recordLiveMinutes(hostUserId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;

    const profile = await this.ensureHostProfile(hostUserId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.prisma.hostDailyStat.upsert({
      where: {
        hostProfileId_date: {
          hostProfileId: profile.id,
          date: today,
        },
      },
      update: {
        liveMinutes: { increment: minutes },
      },
      create: {
        hostProfileId: profile.id,
        date: today,
        liveMinutes: minutes,
      },
    });

    // Also update weekly
    const weekStart = this.getWeekStart(today);
    await this.prisma.hostWeeklyStat.upsert({
      where: {
        hostProfileId_weekStart: {
          hostProfileId: profile.id,
          weekStart,
        },
      },
      update: {
        totalLiveMinutes: { increment: minutes },
      },
      create: {
        hostProfileId: profile.id,
        weekStart,
        totalLiveMinutes: minutes,
      },
    });
  }

  // ──────────────────────────────────────────
  // Daily Salary & Live Bonus Claim
  // ──────────────────────────────────────────

  /**
   * Claim daily salary + live bonus.
   *
   * Host who completes the different live time and diamond receiving
   * target in the current day gets corresponding diamond reward.
   *
   * NOTE: This time bonus is NOT counted for agency commission.
   */
  async claimDailyReward(hostUserId: string) {
    const profile = await this.ensureHostProfile(hostUserId);
    if (profile.isBanned) {
      throw new ForbiddenException('Host is banned');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyStat = await this.getOrCreateDailyStat(profile.id);

    if (dailyStat.bonusClaimed) {
      throw new BadRequestException('Daily reward already claimed for today');
    }

    const liveHours = dailyStat.liveMinutes / 60;
    const tier = getHostSalaryTier(dailyStat.diamondsReceived, liveHours);

    if (!tier) {
      throw new BadRequestException(
        'You have not met the minimum daily target. ' +
          `Required: ${HOST_SALARY_TIERS[0].diamondTarget} diamonds + ${HOST_SALARY_TIERS[0].requiredLiveHours}h live. ` +
          `Current: ${dailyStat.diamondsReceived} diamonds, ${liveHours.toFixed(1)}h live.`,
      );
    }

    // Credit bonus diamonds to host wallet
    const bonusDiamonds = tier.bonusDiamonds;

    await this.prisma.$transaction(async (tx) => {
      // Credit to wallet
      await tx.wallet.update({
        where: { userId: hostUserId },
        data: { diamonds: { increment: bonusDiamonds } },
      });

      // Record transaction
      await tx.transaction.create({
        data: {
          type: TransactionType.HOST_LIVE_BONUS,
          receiverId: hostUserId,
          diamondAmount: bonusDiamonds,
          status: TransactionStatus.COMPLETED,
          description: `Daily live bonus - Level ${tier.level} (${bonusDiamonds} diamonds)`,
          metadata: {
            tier: tier.level,
            diamondsReceived: dailyStat.diamondsReceived,
            liveMinutes: dailyStat.liveMinutes,
          },
        },
      });

      // Mark as claimed
      await tx.hostDailyStat.update({
        where: { id: dailyStat.id },
        data: {
          bonusClaimed: true,
          bonusDiamonds,
        },
      });

      // Record reward claim
      await tx.hostRewardClaim.create({
        data: {
          hostProfileId: profile.id,
          rewardType: 'LIVE_BONUS',
          diamondsAwarded: bonusDiamonds,
          date: today,
          metadata: { tier: tier.level },
        },
      });
    });

    // Update host level
    await this.updateHostLevel(profile.id, dailyStat.diamondsReceived);

    this.logger.log(
      `Daily bonus claimed: ${bonusDiamonds} diamonds for host ${hostUserId} (Level ${tier.level})`,
    );

    return {
      success: true,
      tier: tier.level,
      bonusDiamonds,
      totalDailyIncome: tier.totalDailyIncome,
      salaryUsd: tier.salaryUsd,
      salaryInr: tier.salaryUsd * USD_TO_INR_RATE,
    };
  }

  // ──────────────────────────────────────────
  // New Female Host Reward
  // ──────────────────────────────────────────

  /**
   * Claim new female host reward.
   * For female users newly registered as host within 7 days.
   * 10,000 diamonds/day with 2h/day live for 7 days.
   */
  async claimNewHostReward(hostUserId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
    });

    if (!profile) {
      throw new NotFoundException('Host profile not found');
    }

    if (profile.isBanned) {
      throw new ForbiddenException('Host is banned');
    }

    // Check if host is female
    if (profile.gender !== 'F') {
      throw new BadRequestException('New host reward is only for female hosts');
    }

    // Check if within 7 days of registration
    const daysSinceRegistration = Math.floor(
      (Date.now() - profile.registeredAsHostAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceRegistration >= NEW_FEMALE_HOST_REWARD.eligibleDays) {
      throw new BadRequestException(
        'New host reward is only available within 7 days of registration',
      );
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyStat = await this.getOrCreateDailyStat(profile.id);

    if (dailyStat.newHostRewardClaimed) {
      throw new BadRequestException('New host reward already claimed for today');
    }

    // Check live time requirement
    const liveHours = dailyStat.liveMinutes / 60;
    if (liveHours < NEW_FEMALE_HOST_REWARD.requiredLiveHours) {
      throw new BadRequestException(
        `You need ${NEW_FEMALE_HOST_REWARD.requiredLiveHours}h of live time. ` +
          `Current: ${liveHours.toFixed(1)}h.`,
      );
    }

    const reward = NEW_FEMALE_HOST_REWARD.dailyDiamonds;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: hostUserId },
        data: { diamonds: { increment: reward } },
      });

      await tx.transaction.create({
        data: {
          type: TransactionType.HOST_NEW_REWARD,
          receiverId: hostUserId,
          diamondAmount: reward,
          status: TransactionStatus.COMPLETED,
          description: `New female host daily reward (${reward} diamonds)`,
          metadata: { daysSinceRegistration },
        },
      });

      await tx.hostDailyStat.update({
        where: { id: dailyStat.id },
        data: {
          newHostRewardClaimed: true,
          newHostRewardDiamonds: reward,
        },
      });

      await tx.hostRewardClaim.create({
        data: {
          hostProfileId: profile.id,
          rewardType: 'NEW_HOST',
          diamondsAwarded: reward,
          date: today,
        },
      });
    });

    this.logger.log(`New host reward claimed: ${reward} diamonds for host ${hostUserId}`);

    return {
      success: true,
      diamondsAwarded: reward,
      daysRemaining: NEW_FEMALE_HOST_REWARD.eligibleDays - daysSinceRegistration - 1,
    };
  }

  // ──────────────────────────────────────────
  // Ordinary Female Host Reward
  // ──────────────────────────────────────────

  /**
   * Claim ordinary female host reward.
   * For female users registered > 7 days ago with diamond income < 40,000.
   * 2,000 diamonds/day with 2h/day live.
   */
  async claimOrdinaryHostReward(hostUserId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
    });

    if (!profile) {
      throw new NotFoundException('Host profile not found');
    }

    if (profile.isBanned) {
      throw new ForbiddenException('Host is banned');
    }

    if (profile.gender !== 'F') {
      throw new BadRequestException('Ordinary host reward is only for female hosts');
    }

    const daysSinceRegistration = Math.floor(
      (Date.now() - profile.registeredAsHostAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceRegistration < NEW_FEMALE_HOST_REWARD.eligibleDays) {
      throw new BadRequestException(
        'You are still eligible for the new host reward. Claim that instead.',
      );
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyStat = await this.getOrCreateDailyStat(profile.id);

    // Check if diamond income is less than 40,000
    if (dailyStat.diamondsReceived >= ORDINARY_FEMALE_HOST_REWARD.maxDiamondIncome) {
      throw new BadRequestException(
        'Your diamond income exceeds the ordinary host reward threshold. ' +
          'You qualify for the regular salary tier instead.',
      );
    }

    // Check live time
    const liveHours = dailyStat.liveMinutes / 60;
    if (liveHours < ORDINARY_FEMALE_HOST_REWARD.requiredLiveHours) {
      throw new BadRequestException(
        `You need ${ORDINARY_FEMALE_HOST_REWARD.requiredLiveHours}h of live time. ` +
          `Current: ${liveHours.toFixed(1)}h.`,
      );
    }

    // Check if already claimed today (reuse newHostRewardClaimed since it's the same daily check)
    const existingClaim = await this.prisma.hostRewardClaim.findFirst({
      where: {
        hostProfileId: profile.id,
        rewardType: 'ORDINARY',
        date: today,
      },
    });

    if (existingClaim) {
      throw new BadRequestException('Ordinary host reward already claimed for today');
    }

    const reward = ORDINARY_FEMALE_HOST_REWARD.dailyDiamonds;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: hostUserId },
        data: { diamonds: { increment: reward } },
      });

      await tx.transaction.create({
        data: {
          type: TransactionType.HOST_ORDINARY_REWARD,
          receiverId: hostUserId,
          diamondAmount: reward,
          status: TransactionStatus.COMPLETED,
          description: `Ordinary female host daily reward (${reward} diamonds)`,
        },
      });

      await tx.hostRewardClaim.create({
        data: {
          hostProfileId: profile.id,
          rewardType: 'ORDINARY',
          diamondsAwarded: reward,
          date: today,
        },
      });
    });

    this.logger.log(`Ordinary host reward claimed: ${reward} diamonds for host ${hostUserId}`);

    return {
      success: true,
      diamondsAwarded: reward,
    };
  }

  // ──────────────────────────────────────────
  // Superstar Host Management
  // ──────────────────────────────────────────

  /**
   * Register a host as superstar (admin operation).
   * Must pass online audition.
   */
  async registerSuperstar(
    hostUserId: string,
    tag: string,
    month?: Date,
  ) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
    });

    if (!profile) {
      throw new NotFoundException('Host profile not found');
    }

    const superstarTier = getSuperstarTier(tag);
    if (!superstarTier) {
      throw new BadRequestException(`Invalid superstar tag: ${tag}`);
    }

    const monthStart = month || new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    await this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: {
        isSuperstar: true,
        superstarTag: tag as any,
      },
    });

    const record = await this.prisma.superstarRecord.upsert({
      where: {
        hostProfileId_month: {
          hostProfileId: profile.id,
          month: monthStart,
        },
      },
      update: {
        tag: tag as any,
        diamondTarget: superstarTier.diamondTarget,
        timeTargetHours: superstarTier.timeTargetHours,
      },
      create: {
        hostProfileId: profile.id,
        tag: tag as any,
        month: monthStart,
        diamondTarget: superstarTier.diamondTarget,
        timeTargetHours: superstarTier.timeTargetHours,
      },
    });

    this.logger.log(`Superstar registered: host ${hostUserId}, tag ${tag}`);
    return record;
  }

  /**
   * Process superstar salary for a given month.
   * Called on the 1st of the next month.
   *
   * Rules:
   * - Must complete time target + diamond target
   * - Must follow arrangement by official
   * - Fixed salary released by diamonds
   * - Agency owner gets 10 USD bonus per superstar host that completes target
   */
  async processSuperstarSalaries(month: Date) {
    const monthStart = new Date(month);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const records = await this.prisma.superstarRecord.findMany({
      where: {
        month: monthStart,
        fixedSalaryPaid: false,
      },
      include: {
        hostProfile: {
          include: {
            user: true,
            agency: true,
          },
        },
      },
    });

    const results: Array<{
      hostUserId: string;
      tag: string;
      targetMet: boolean;
      bonusUsd: number;
    }> = [];

    for (const record of records) {
      const tier = getSuperstarTier(record.tag);
      if (!tier) continue;

      const targetMet =
        record.totalDiamonds >= record.diamondTarget &&
        (tier.timeTargetHours === 0 || record.totalLiveHours >= tier.timeTargetHours);

      if (!targetMet) {
        results.push({
          hostUserId: record.hostProfile.userId,
          tag: record.tag,
          targetMet: false,
          bonusUsd: 0,
        });
        continue;
      }

      const bonusDiamonds = tier.extraBonusUsd * HOST_DIAMOND_TO_USD_RATE;

      await this.prisma.$transaction(async (tx) => {
        // Credit superstar salary to host
        await tx.wallet.update({
          where: { userId: record.hostProfile.userId },
          data: { diamonds: { increment: bonusDiamonds } },
        });

        await tx.transaction.create({
          data: {
            type: TransactionType.HOST_SUPERSTAR_SALARY,
            receiverId: record.hostProfile.userId,
            diamondAmount: bonusDiamonds,
            status: TransactionStatus.COMPLETED,
            description: `Superstar ${record.tag} monthly salary (${tier.extraBonusUsd} USD)`,
            metadata: {
              tag: record.tag,
              month: monthStart.toISOString(),
              totalDiamonds: record.totalDiamonds,
              totalLiveHours: record.totalLiveHours,
            },
          },
        });

        // Mark as paid
        await tx.superstarRecord.update({
          where: { id: record.id },
          data: {
            targetMet: true,
            fixedSalaryPaid: true,
            extraBonusUsd: tier.extraBonusUsd,
          },
        });

        // Credit agency owner bonus (10 USD per superstar that completes)
        if (record.hostProfile.agency) {
          const agencyBonusDiamonds =
            AGENCY_BONUS_PER_SUPERSTAR_USD * HOST_DIAMOND_TO_USD_RATE;

          await tx.wallet.update({
            where: { userId: record.hostProfile.agency.ownerId },
            data: { diamonds: { increment: agencyBonusDiamonds } },
          });

          await tx.transaction.create({
            data: {
              type: TransactionType.HOST_SUPERSTAR_SALARY,
              receiverId: record.hostProfile.agency.ownerId,
              diamondAmount: agencyBonusDiamonds,
              status: TransactionStatus.COMPLETED,
              description: `Agency bonus for superstar host ${record.hostProfile.user.username || record.hostProfile.userId} completing target`,
              metadata: {
                hostUserId: record.hostProfile.userId,
                tag: record.tag,
              },
            },
          });
        }

        // Record claim
        await tx.hostRewardClaim.create({
          data: {
            hostProfileId: record.hostProfile.id,
            rewardType: 'SUPERSTAR',
            diamondsAwarded: bonusDiamonds,
            date: monthStart,
            metadata: { tag: record.tag, bonusUsd: tier.extraBonusUsd },
          },
        });
      });

      results.push({
        hostUserId: record.hostProfile.userId,
        tag: record.tag,
        targetMet: true,
        bonusUsd: tier.extraBonusUsd,
      });

      this.logger.log(
        `Superstar salary paid: ${bonusDiamonds} diamonds to host ${record.hostProfile.userId} (tag: ${record.tag})`,
      );
    }

    return results;
  }

  // ──────────────────────────────────────────
  // Host Dashboard & Status
  // ──────────────────────────────────────────

  /**
   * Get host reward status for today
   */
  async getHostRewardStatus(hostUserId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
      include: {
        agency: { select: { id: true, name: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('Host profile not found');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyStat = await this.getOrCreateDailyStat(profile.id);
    const liveHours = dailyStat.liveMinutes / 60;

    // Current salary tier
    const currentTier = getHostSalaryTier(dailyStat.diamondsReceived, liveHours);

    // Days since registration
    const daysSinceRegistration = Math.floor(
      (Date.now() - profile.registeredAsHostAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Check new/ordinary host reward eligibility
    const isNewFemaleHost =
      profile.gender === 'F' && daysSinceRegistration < NEW_FEMALE_HOST_REWARD.eligibleDays;
    const isOrdinaryFemaleHost =
      profile.gender === 'F' &&
      daysSinceRegistration >= NEW_FEMALE_HOST_REWARD.eligibleDays &&
      dailyStat.diamondsReceived < ORDINARY_FEMALE_HOST_REWARD.maxDiamondIncome;

    // Weekly stats
    const weekStart = this.getWeekStart(today);
    const weeklyStat = await this.prisma.hostWeeklyStat.findUnique({
      where: {
        hostProfileId_weekStart: {
          hostProfileId: profile.id,
          weekStart,
        },
      },
    });

    // Superstar info
    let superstarInfo: any = null;
    if (profile.isSuperstar && profile.superstarTag) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const superstarRecord = await this.prisma.superstarRecord.findUnique({
        where: {
          hostProfileId_month: {
            hostProfileId: profile.id,
            month: monthStart,
          },
        },
      });

      const tier = getSuperstarTier(profile.superstarTag);
      superstarInfo = {
        tag: profile.superstarTag,
        diamondTarget: tier?.diamondTarget || 0,
        timeTargetHours: tier?.timeTargetHours || 0,
        extraBonusUsd: tier?.extraBonusUsd || 0,
        currentDiamonds: superstarRecord?.totalDiamonds || 0,
        currentLiveHours: superstarRecord?.totalLiveHours || 0,
        targetMet: superstarRecord?.targetMet || false,
      };
    }

    // Reward claim history for today
    const todayClaims = await this.prisma.hostRewardClaim.findMany({
      where: {
        hostProfileId: profile.id,
        date: today,
      },
    });

    return {
      profile: {
        hostLevel: profile.hostLevel,
        gender: profile.gender,
        isSuperstar: profile.isSuperstar,
        registeredAt: profile.registeredAsHostAt,
        daysSinceRegistration,
        agency: profile.agency,
      },
      today: {
        diamondsReceived: dailyStat.diamondsReceived,
        liveMinutes: dailyStat.liveMinutes,
        liveHours: parseFloat(liveHours.toFixed(1)),
        currentTier: currentTier?.level || null,
        bonusDiamonds: currentTier?.bonusDiamonds || 0,
        bonusClaimed: dailyStat.bonusClaimed,
      },
      weekly: {
        diamondsReceived: weeklyStat?.diamondsReceived || 0,
        totalLiveMinutes: weeklyStat?.totalLiveMinutes || 0,
        bonusClaimed: weeklyStat?.bonusClaimed || false,
      },
      eligibility: {
        newFemaleHostReward: isNewFemaleHost,
        newHostRewardClaimed: dailyStat.newHostRewardClaimed,
        ordinaryFemaleHostReward: isOrdinaryFemaleHost,
        ordinaryRewardClaimed: todayClaims.some((c) => c.rewardType === 'ORDINARY'),
        dailyBonusEligible: !!currentTier && !dailyStat.bonusClaimed,
      },
      superstar: superstarInfo,
      salaryTiers: HOST_SALARY_TIERS.map((t) => ({
        level: t.level,
        diamondTarget: t.diamondTarget,
        requiredLiveHours: t.requiredLiveHours,
        bonusDiamonds: t.bonusDiamonds,
        totalDailyIncome: t.totalDailyIncome,
        salaryUsd: t.salaryUsd,
        salaryInr: t.salaryUsd * USD_TO_INR_RATE,
      })),
      withdrawalRules: {
        diamondToUsdRate: HOST_DIAMOND_TO_USD_RATE,
        usdToInrRate: USD_TO_INR_RATE,
        minWithdrawalUsd: HOST_WITHDRAWAL_RULES.minAmountUsd,
        multipleOfUsd: HOST_WITHDRAWAL_RULES.multipleOfUsd,
        cashOutDay: 'Monday',
        paymentDay: 'Before Thursday',
      },
    };
  }

  /**
   * Get host reward history
   */
  async getRewardHistory(hostUserId: string, page: number = 1, limit: number = 20) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
    });

    if (!profile) {
      throw new NotFoundException('Host profile not found');
    }

    const skip = (page - 1) * limit;

    const [claims, total] = await Promise.all([
      this.prisma.hostRewardClaim.findMany({
        where: { hostProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.hostRewardClaim.count({
        where: { hostProfileId: profile.id },
      }),
    ]);

    return {
      data: claims.map((c) => ({
        id: c.id,
        rewardType: c.rewardType,
        diamondsAwarded: c.diamondsAwarded,
        usdValue: (c.diamondsAwarded / HOST_DIAMOND_TO_USD_RATE).toFixed(2),
        date: c.date,
        createdAt: c.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ──────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────

  /**
   * Update host level based on daily diamond income
   */
  private async updateHostLevel(hostProfileId: string, diamondsReceived: number) {
    let newLevel = 'NONE';
    for (let i = HOST_SALARY_TIERS.length - 1; i >= 0; i--) {
      if (diamondsReceived >= HOST_SALARY_TIERS[i].diamondTarget) {
        newLevel = HOST_SALARY_TIERS[i].level;
        break;
      }
    }

    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: { hostLevel: newLevel as any },
    });
  }

  /**
   * Get the Monday of the current week
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    d.setUTCDate(diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
