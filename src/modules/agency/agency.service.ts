import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TransactionType, TransactionStatus, Prisma } from '@prisma/client';
import {
  AGENCY_TIERS,
  AGENCY_DIAMOND_TO_USD_RATE,
  getAgencyTier,
  getCommissionRate,
} from './constants/agency-tiers.constant';
import { CreateAgencyDto } from './dto/create-agency.dto';

@Injectable()
export class AgencyService {
  private readonly logger = new Logger(AgencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────
  // Agency CRUD
  // ──────────────────────────────────────────

  /**
   * Create a new agency. The user becomes the agency owner.
   */
  async createAgency(userId: string, dto: CreateAgencyDto) {
    // Check if user already owns an agency
    const existing = await this.prisma.agency.findUnique({
      where: { ownerId: userId },
    });
    if (existing) {
      throw new ConflictException('User already owns an agency');
    }

    // If parentAgencyId is given, validate it exists
    if (dto.parentAgencyId) {
      const parent = await this.prisma.agency.findUnique({
        where: { id: dto.parentAgencyId },
      });
      if (!parent) {
        throw new NotFoundException('Parent agency not found');
      }
      if (parent.isBanned) {
        throw new ForbiddenException('Parent agency is banned');
      }
    }

    const agency = await this.prisma.agency.create({
      data: {
        ownerId: userId,
        name: dto.name,
        parentAgencyId: dto.parentAgencyId || null,
      },
    });

    // Upgrade user role to AGENCY
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'AGENCY' },
    });

    this.logger.log(`Agency created: ${agency.id} by user ${userId}`);
    return agency;
  }

  /**
   * Get agency details with sub-agencies and hosts
   */
  async getAgency(agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        owner: { select: { id: true, username: true, phone: true } },
        subAgencies: {
          include: {
            owner: { select: { id: true, username: true } },
          },
        },
        hosts: {
          include: {
            user: { select: { id: true, username: true, phone: true } },
          },
        },
      },
    });

    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    return agency;
  }

  /**
   * Get the agency owned by a user
   */
  async getMyAgency(userId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { ownerId: userId },
      include: {
        subAgencies: {
          include: {
            owner: { select: { id: true, username: true } },
            _count: { select: { hosts: true } },
          },
        },
        hosts: {
          include: {
            user: { select: { id: true, username: true } },
            dailyStats: {
              take: 1,
              orderBy: { date: 'desc' },
            },
          },
        },
        parentAgency: {
          select: { id: true, name: true },
        },
      },
    });

    if (!agency) {
      throw new NotFoundException('You do not own an agency');
    }

    return agency;
  }

  /**
   * Add a host to the agency
   */
  async addHostToAgency(agencyId: string, ownerId: string, hostUserId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
    });

    if (!agency || agency.ownerId !== ownerId) {
      throw new ForbiddenException('Not your agency');
    }

    if (agency.isBanned) {
      throw new ForbiddenException('Agency is banned');
    }

    // Check user exists and is a HOST
    const user = await this.prisma.user.findUnique({
      where: { id: hostUserId },
      include: { hostProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== 'HOST') {
      throw new BadRequestException('User is not a host');
    }

    // Create or update host profile
    if (user.hostProfile) {
      if (user.hostProfile.agencyId) {
        throw new ConflictException('Host is already assigned to an agency');
      }
      await this.prisma.hostProfile.update({
        where: { id: user.hostProfile.id },
        data: { agencyId },
      });
    } else {
      await this.prisma.hostProfile.create({
        data: {
          userId: hostUserId,
          agencyId,
        },
      });
    }

    this.logger.log(`Host ${hostUserId} added to agency ${agencyId}`);
    return { success: true, message: 'Host added to agency' };
  }

  /**
   * Remove a host from the agency
   */
  async removeHostFromAgency(agencyId: string, ownerId: string, hostUserId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
    });

    if (!agency || agency.ownerId !== ownerId) {
      throw new ForbiddenException('Not your agency');
    }

    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
    });

    if (!hostProfile || hostProfile.agencyId !== agencyId) {
      throw new BadRequestException('Host is not in your agency');
    }

    await this.prisma.hostProfile.update({
      where: { id: hostProfile.id },
      data: { agencyId: null },
    });

    return { success: true, message: 'Host removed from agency' };
  }

  // ──────────────────────────────────────────
  // Commission Calculation
  // ──────────────────────────────────────────

  /**
   * Calculate the rolling 30 days + current day total diamond income
   * for an agency (own hosts + all sub-agencies' hosts).
   */
  async calculateAgencyTotalDiamonds(agencyId: string): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

    // Get all agency IDs in the hierarchy (self + all recursive sub-agencies)
    const allAgencyIds = await this.getAllSubAgencyIds(agencyId);
    allAgencyIds.push(agencyId);

    // Get all host userIds under these agencies
    const hostProfiles = await this.prisma.hostProfile.findMany({
      where: { agencyId: { in: allAgencyIds } },
      select: { userId: true },
    });

    if (hostProfiles.length === 0) return 0;

    const hostUserIds = hostProfiles.map((h) => h.userId);

    // Sum diamonds received by these hosts from gifts (CHAT_PAYMENT)
    // Excludes platform rewards (DAILY_BONUS, REFERRAL_REWARD, etc.)
    const result = await this.prisma.transaction.aggregate({
      where: {
        receiverId: { in: hostUserIds },
        type: 'CHAT_PAYMENT',
        status: 'COMPLETED',
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { diamondAmount: true },
    });

    return result._sum?.diamondAmount || 0;
  }

  /**
   * Get all sub-agency IDs recursively
   */
  async getAllSubAgencyIds(agencyId: string): Promise<string[]> {
    const subAgencies = await this.prisma.agency.findMany({
      where: { parentAgencyId: agencyId, isBanned: false },
      select: { id: true },
    });

    const ids = subAgencies.map((s) => s.id);
    for (const sub of subAgencies) {
      const nested = await this.getAllSubAgencyIds(sub.id);
      ids.push(...nested);
    }

    return ids;
  }

  /**
   * Get the direct sub-agencies total diamonds (each sub-agency individually)
   * to compute their individual commission rates.
   */
  async getSubAgencyDiamondBreakdown(agencyId: string): Promise<
    Array<{ subAgencyId: string; totalDiamonds: number; commissionRate: number }>
  > {
    const subAgencies = await this.prisma.agency.findMany({
      where: { parentAgencyId: agencyId, isBanned: false },
      select: { id: true },
    });

    const breakdown: Array<{
      subAgencyId: string;
      totalDiamonds: number;
      commissionRate: number;
    }> = [];

    for (const sub of subAgencies) {
      const totalDiamonds = await this.calculateAgencyTotalDiamonds(sub.id);
      const rate = getCommissionRate(totalDiamonds);
      breakdown.push({
        subAgencyId: sub.id,
        totalDiamonds,
        commissionRate: rate,
      });
    }

    return breakdown;
  }

  /**
   * Process commission when a host receives a gift.
   *
   * Called in real-time when a gift transaction completes.
   * Credits commission diamonds to the agency owner's wallet.
   *
   * Commission = rate * gift amount (for own hosts)
   * Commission = (own rate - sub-agency rate) * gift amount (for sub-agency hosts)
   */
  async processGiftCommission(
    hostUserId: string,
    giftDiamonds: number,
  ): Promise<void> {
    if (giftDiamonds <= 0) return;

    // Find the host's profile and agency
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
      include: { agency: true },
    });

    if (!hostProfile?.agencyId || !hostProfile.agency) return;

    // Walk up the agency hierarchy and credit commission to each level
    await this.creditCommissionUpward(
      hostProfile.agencyId,
      hostUserId,
      giftDiamonds,
      null, // no sub-agency at the direct level
    );
  }

  /**
   * Recursively credit commission up the agency hierarchy.
   *
   * For the direct agency of the host: commission = rate * giftDiamonds
   * For parent agencies: commission = (parentRate - childRate) * giftDiamonds
   */
  private async creditCommissionUpward(
    agencyId: string,
    hostUserId: string,
    giftDiamonds: number,
    childAgencyId: string | null,
  ): Promise<void> {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      include: { owner: true },
    });

    if (!agency || agency.isBanned) return;

    // Calculate this agency's total diamonds for rate determination
    const agencyTotalDiamonds = await this.calculateAgencyTotalDiamonds(agencyId);
    const agencyRate = getCommissionRate(agencyTotalDiamonds);

    let subAgencyRate = 0;
    let effectiveRate: number;

    if (childAgencyId) {
      // This is a parent agency earning commission from a sub-agency's host
      const childTotalDiamonds = await this.calculateAgencyTotalDiamonds(childAgencyId);
      subAgencyRate = getCommissionRate(childTotalDiamonds);
      effectiveRate = Math.max(0, agencyRate - subAgencyRate);
    } else {
      // This is the direct agency of the host
      effectiveRate = agencyRate;
    }

    if (effectiveRate <= 0) {
      // If parent rate <= child rate, no commission for parent
      // But still check grandparent
      if (agency.parentAgencyId) {
        await this.creditCommissionUpward(
          agency.parentAgencyId,
          hostUserId,
          giftDiamonds,
          agencyId,
        );
      }
      return;
    }

    const commissionDiamonds = Math.floor(giftDiamonds * effectiveRate);
    if (commissionDiamonds <= 0) return;

    // Credit commission to agency owner's wallet
    await this.prisma.$transaction(async (tx) => {
      // Ensure wallet exists
      let wallet = await tx.wallet.findUnique({
        where: { userId: agency.ownerId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId: agency.ownerId },
        });
      }

      // Credit diamonds
      await tx.wallet.update({
        where: { userId: agency.ownerId },
        data: { diamonds: { increment: commissionDiamonds } },
      });

      // Record transaction
      await tx.transaction.create({
        data: {
          type: TransactionType.AGENCY_COMMISSION,
          receiverId: agency.ownerId,
          diamondAmount: commissionDiamonds,
          status: TransactionStatus.COMPLETED,
          description: childAgencyId
            ? `Agency commission from sub-agency host (rate: ${(effectiveRate * 100).toFixed(1)}%)`
            : `Agency commission from own host (rate: ${(effectiveRate * 100).toFixed(1)}%)`,
          metadata: {
            agencyId: agency.id,
            hostUserId,
            giftDiamonds,
            agencyRate,
            subAgencyRate,
            effectiveRate,
            sourceAgencyId: childAgencyId,
          },
        },
      });

      // Log commission
      await tx.agencyCommissionLog.create({
        data: {
          agencyId: agency.id,
          sourceAgencyId: childAgencyId,
          hostId: hostUserId,
          giftDiamonds,
          commissionRate: agencyRate,
          subAgencyRate,
          effectiveRate,
          diamondsEarned: commissionDiamonds,
        },
      });
    });

    this.logger.log(
      `Commission: ${commissionDiamonds} diamonds to agency ${agency.id} ` +
        `(rate: ${(effectiveRate * 100).toFixed(1)}%, gift: ${giftDiamonds})`,
    );

    // Update agency level
    const tier = getAgencyTier(agencyTotalDiamonds);
    if (agency.level !== tier.level) {
      await this.prisma.agency.update({
        where: { id: agency.id },
        data: { level: tier.level as any },
      });
    }

    // Continue up the hierarchy
    if (agency.parentAgencyId) {
      await this.creditCommissionUpward(
        agency.parentAgencyId,
        hostUserId,
        giftDiamonds,
        agencyId,
      );
    }
  }

  // ──────────────────────────────────────────
  // Dashboard & Analytics
  // ──────────────────────────────────────────

  /**
   * Get agency dashboard with commission stats
   */
  async getAgencyDashboard(userId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { ownerId: userId },
      include: {
        subAgencies: {
          where: { isBanned: false },
          select: { id: true, name: true, level: true },
        },
        hosts: {
          include: {
            user: { select: { id: true, username: true } },
          },
        },
      },
    });

    if (!agency) {
      throw new NotFoundException('You do not own an agency');
    }

    // Total diamonds in rolling 30 days
    const totalDiamonds = await this.calculateAgencyTotalDiamonds(agency.id);
    const tier = getAgencyTier(totalDiamonds);

    // Sub-agency breakdown
    const subAgencyBreakdown = await this.getSubAgencyDiamondBreakdown(agency.id);

    // Today's commission earnings
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayCommission = await this.prisma.agencyCommissionLog.aggregate({
      where: {
        agencyId: agency.id,
        createdAt: { gte: todayStart },
      },
      _sum: { diamondsEarned: true },
    });

    // Last 30 days commission earnings
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthlyCommission = await this.prisma.agencyCommissionLog.aggregate({
      where: {
        agencyId: agency.id,
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { diamondsEarned: true },
    });

    // Wallet balance
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { diamonds: true },
    });

    return {
      agency: {
        id: agency.id,
        name: agency.name,
        level: tier.level,
        commissionRate: `${(tier.commissionRate * 100).toFixed(0)}%`,
        isBanned: agency.isBanned,
      },
      stats: {
        totalDiamonds30Days: totalDiamonds,
        todayCommissionDiamonds: todayCommission._sum?.diamondsEarned || 0,
        monthlyCommissionDiamonds: monthlyCommission._sum?.diamondsEarned || 0,
        todayCommissionUsd:
          ((todayCommission._sum?.diamondsEarned || 0) / AGENCY_DIAMOND_TO_USD_RATE).toFixed(2),
        monthlyCommissionUsd:
          ((monthlyCommission._sum?.diamondsEarned || 0) / AGENCY_DIAMOND_TO_USD_RATE).toFixed(2),
        walletDiamonds: wallet?.diamonds || 0,
      },
      hosts: agency.hosts.map((h) => ({
        id: h.userId,
        username: h.user.username,
        hostLevel: h.hostLevel,
      })),
      subAgencies: subAgencyBreakdown.map((s) => ({
        ...s,
        commissionRateDisplay: `${(s.commissionRate * 100).toFixed(0)}%`,
        effectiveRate: `${((tier.commissionRate - s.commissionRate) * 100).toFixed(0)}%`,
      })),
      tiers: AGENCY_TIERS.map((t) => ({
        level: t.level,
        minDiamonds: t.minDiamonds,
        maxDiamonds: t.maxDiamonds === Infinity ? 'unlimited' : t.maxDiamonds,
        rate: `${(t.commissionRate * 100).toFixed(0)}%`,
        salaryRange: `${(t.minDiamonds * t.commissionRate / AGENCY_DIAMOND_TO_USD_RATE).toFixed(0)}-${t.maxDiamonds === Infinity ? '∞' : (t.maxDiamonds * t.commissionRate / AGENCY_DIAMOND_TO_USD_RATE).toFixed(0)} USD`,
      })),
    };
  }

  /**
   * Get commission history for an agency
   */
  async getCommissionHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const agency = await this.prisma.agency.findUnique({
      where: { ownerId: userId },
    });

    if (!agency) {
      throw new NotFoundException('You do not own an agency');
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.prisma.agencyCommissionLog.findMany({
        where: { agencyId: agency.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.agencyCommissionLog.count({
        where: { agencyId: agency.id },
      }),
    ]);

    return {
      data: logs.map((log) => ({
        id: log.id,
        giftDiamonds: log.giftDiamonds,
        commissionRate: `${(log.commissionRate * 100).toFixed(0)}%`,
        subAgencyRate: `${(log.subAgencyRate * 100).toFixed(0)}%`,
        effectiveRate: `${(log.effectiveRate * 100).toFixed(0)}%`,
        diamondsEarned: log.diamondsEarned,
        usdValue: (log.diamondsEarned / AGENCY_DIAMOND_TO_USD_RATE).toFixed(2),
        isFromSubAgency: !!log.sourceAgencyId,
        createdAt: log.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Ban/unban an agency (admin only)
   */
  async setAgencyBanStatus(agencyId: string, isBanned: boolean) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
    });

    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    await this.prisma.agency.update({
      where: { id: agencyId },
      data: { isBanned },
    });

    this.logger.log(`Agency ${agencyId} ${isBanned ? 'banned' : 'unbanned'}`);
    return { success: true, isBanned };
  }
}
