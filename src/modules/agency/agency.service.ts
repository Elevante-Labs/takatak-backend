import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TransactionType, TransactionStatus, Prisma, Role } from '@prisma/client';
import {
  AGENCY_TIERS,
  AGENCY_DIAMOND_TO_USD_RATE,
  getAgencyTier,
  getCommissionRate,
} from './constants/agency-tiers.constant';
import { CreateAgencyDto } from './dto/create-agency.dto';

// Type alias for a Prisma interactive-transaction client
type TxClient = Prisma.TransactionClient;

@Injectable()
export class AgencyService {
  private readonly logger = new Logger(AgencyService.name);

  // Injected lazily by AgencyModule after gateway is registered
  private gateway: any = null;

  constructor(private readonly prisma: PrismaService) { }

  /** Called by AgencyModule to set gateway reference (avoids circular dep) */
  setGateway(gw: any) {
    this.gateway = gw;
  }

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
      data: { role: 'AGENCY' as any },
    });

    this.logger.log(`Agency created: ${agency.id} by user ${userId}`);
    return agency;
  }

  /**
   * Get agency details with sub-agencies and hosts.
   * Restricted to agency owner or admin (enforced by controller).
   */
  async getAgency(agencyId: string, requestingUserId?: string, requestingRole?: string) {
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

    // Security: only agency owner or admin can view
    if (requestingUserId && requestingRole) {
      if (agency.ownerId !== requestingUserId && requestingRole !== 'ADMIN') {
        throw new ForbiddenException('Access denied');
      }
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
   * Add a host to the agency (by agency owner)
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
    }) as any;

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== 'HOST') {
      throw new BadRequestException('User is not a host');
    }

    // Security: prevent adding banned hosts
    if (user.hostProfile?.isBanned) {
      throw new ForbiddenException('Cannot add a banned host to agency');
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

    // Emit WebSocket event after commit
    this.emitEvent('hostAdded', agency.ownerId, {
      agencyId,
      hostUserId,
    });

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

    // Emit WebSocket event after commit
    this.emitEvent('hostRemoved', agency.ownerId, {
      agencyId,
      hostUserId,
    });

    return { success: true, message: 'Host removed from agency' };
  }

  // ──────────────────────────────────────────
  // Join / Leave Flow
  // ──────────────────────────────────────────

  /**
   * Host requests to join an agency.
   * Validates: host role, not banned, not already in an agency, target agency not banned.
   */
  async joinAgency(hostUserId: string, agencyId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: hostUserId },
      include: { hostProfile: true },
    }) as any;

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== 'HOST') {
      throw new ForbiddenException('Only hosts can join agencies');
    }

    if (user.hostProfile?.isBanned) {
      throw new ForbiddenException('Banned hosts cannot join agencies');
    }

    if (user.hostProfile?.agencyId) {
      throw new ConflictException('You are already in an agency. Leave first.');
    }

    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
    });

    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    if (agency.isBanned) {
      throw new ForbiddenException('Cannot join a banned agency');
    }

    if (user.hostProfile) {
      await this.prisma.hostProfile.update({
        where: { id: user.hostProfile.id },
        data: { agencyId },
      });
    } else {
      await this.prisma.hostProfile.create({
        data: { userId: hostUserId, agencyId },
      });
    }

    this.logger.log(`Host ${hostUserId} joined agency ${agencyId}`);

    this.emitEvent('hostAdded', agency.ownerId, {
      agencyId,
      hostUserId,
    });

    return { success: true, message: 'Joined agency successfully' };
  }

  /**
   * Host leaves their current agency.
   */
  async leaveAgency(hostUserId: string) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
      include: { agency: true },
    });

    if (!hostProfile || !hostProfile.agencyId) {
      throw new BadRequestException('You are not in any agency');
    }

    const agencyOwnerId = hostProfile.agency?.ownerId;
    const agencyId = hostProfile.agencyId;

    await this.prisma.hostProfile.update({
      where: { id: hostProfile.id },
      data: { agencyId: null },
    });

    this.logger.log(`Host ${hostUserId} left agency ${agencyId}`);

    if (agencyOwnerId) {
      this.emitEvent('hostRemoved', agencyOwnerId, {
        agencyId,
        hostUserId,
      });
    }

    return { success: true, message: 'Left agency successfully' };
  }

  // ──────────────────────────────────────────
  // Commission Calculation (Atomic, Idempotent)
  // ──────────────────────────────────────────

  /**
   * Get all sub-agency IDs recursively.
   * Can use tx or default prisma client.
   */
  async getAllSubAgencyIds(agencyId: string, client?: TxClient): Promise<string[]> {
    const db = client || this.prisma;
    const subAgencies = await db.agency.findMany({
      where: { parentAgencyId: agencyId, isBanned: false },
      select: { id: true },
    });

    const ids = subAgencies.map((s) => s.id);
    for (const sub of subAgencies) {
      const nested = await this.getAllSubAgencyIds(sub.id, client);
      ids.push(...nested);
    }

    return ids;
  }

  /**
   * Calculate the rolling 30 days + current day total diamond income
   * for an agency (own hosts + all sub-agencies' hosts).
   *
   * NOTE: This is now used ONLY for dashboard/analytics (read path).
   * The write path uses rollingDiamonds30d for performance.
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
   * Process commission when a host receives a gift.
   *
   * CRITICAL: This must be called INSIDE the main processChatPayment
   * prisma.$transaction so that commission is atomic with the payment.
   *
   * @param hostUserId - the host who received the gift
   * @param giftDiamonds - amount of diamonds the host received
   * @param originalTransactionId - the CHAT_PAYMENT Transaction.id
   * @param tx - Prisma transaction client from the parent transaction
   */
  async processGiftCommission(
    hostUserId: string,
    giftDiamonds: number,
    originalTransactionId: string,
    tx: TxClient,
  ): Promise<{ tierChanges: Array<{ agencyId: string; oldLevel: string; newLevel: string }> }> {
    const tierChanges: Array<{ agencyId: string; oldLevel: string; newLevel: string }> = [];

    if (giftDiamonds <= 0) return { tierChanges };

    // All reads go through tx to prevent race conditions (edge case D)
    const hostProfile = await tx.hostProfile.findUnique({
      where: { userId: hostUserId },
      include: { agency: true },
    });

    if (!hostProfile?.agencyId || !hostProfile.agency) return { tierChanges };

    // Walk up the agency hierarchy and credit commission to each level
    await this.creditCommissionUpward(
      hostProfile.agencyId,
      hostUserId,
      giftDiamonds,
      originalTransactionId,
      null, // no sub-agency at the direct level
      tx,
      tierChanges,
    );

    return { tierChanges };
  }

  /**
   * Recursively credit commission up the agency hierarchy.
   * All operations go through the tx client for atomicity.
   *
   * For the direct agency of the host: commission = rate * giftDiamonds
   * For parent agencies: commission = (parentRate - childRate) * giftDiamonds
   */
  private async creditCommissionUpward(
    agencyId: string,
    hostUserId: string,
    giftDiamonds: number,
    originalTransactionId: string,
    childAgencyId: string | null,
    tx: TxClient,
    tierChanges: Array<{ agencyId: string; oldLevel: string; newLevel: string }>,
  ): Promise<void> {
    // All reads via tx (edge case D: host removed mid-transaction)
    const agency = await tx.agency.findUnique({
      where: { id: agencyId },
      include: { owner: true },
    });

    if (!agency || agency.isBanned) return;

    // ── Idempotency guard (edge case A: parent+child) ──
    // Check if commission already exists for (agencyId, originalTransactionId, isReversal=false)
    const existingLog = await tx.agencyCommissionLog.findUnique({
      where: {
        agencyId_originalTransactionId_isReversal: {
          agencyId,
          originalTransactionId,
          isReversal: false,
        },
      },
    });

    if (existingLog) {
      this.logger.warn(
        `Idempotency: commission already exists for agency ${agencyId}, tx ${originalTransactionId}`,
      );
      // Still continue up the hierarchy in case parent hasn't been credited
      if (agency.parentAgencyId) {
        await this.creditCommissionUpward(
          agency.parentAgencyId,
          hostUserId,
          giftDiamonds,
          originalTransactionId,
          agencyId,
          tx,
          tierChanges,
        );
      }
      return;
    }

    // ── Rate calculation using cached rolling counter (performance opt) ──
    const agencyRate = getCommissionRate(agency.rollingDiamonds30d);

    let subAgencyRate = 0;
    let effectiveRate: number;

    if (childAgencyId) {
      // This is a parent agency earning commission from a sub-agency's host
      const childAgency = await tx.agency.findUnique({
        where: { id: childAgencyId },
      });
      subAgencyRate = childAgency
        ? getCommissionRate(childAgency.rollingDiamonds30d)
        : 0;
      effectiveRate = Math.max(0, agencyRate - subAgencyRate);
    } else {
      // This is the direct agency of the host
      effectiveRate = agencyRate;
    }

    if (effectiveRate <= 0) {
      // If parent rate <= child rate, no commission for parent.
      // But still check grandparent.
      if (agency.parentAgencyId) {
        await this.creditCommissionUpward(
          agency.parentAgencyId,
          hostUserId,
          giftDiamonds,
          originalTransactionId,
          agencyId,
          tx,
          tierChanges,
        );
      }
      return;
    }

    const commissionDiamonds = Math.floor(giftDiamonds * effectiveRate);
    if (commissionDiamonds <= 0) return;

    // ── Row-level lock on agency owner wallet (concurrency hardening) ──
    const ownerWallets = await tx.$queryRaw<
      Array<{ id: string; userId: string; diamonds: number }>
    >(
      Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${agency.ownerId}::uuid FOR UPDATE`,
    );

    if (!ownerWallets[0]) {
      // Create wallet if missing
      await tx.wallet.create({ data: { userId: agency.ownerId } });
    }

    // Credit diamonds using increment (concurrency safe)
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
          originalTransactionId,
        },
      },
    });

    // Log commission (with originalTransactionId for idempotency)
    await tx.agencyCommissionLog.create({
      data: {
        agencyId: agency.id,
        originalTransactionId,
        sourceAgencyId: childAgencyId,
        hostId: hostUserId,
        giftDiamonds,
        commissionRate: agencyRate,
        subAgencyRate,
        effectiveRate,
        diamondsEarned: commissionDiamonds,
        isReversal: false,
      },
    });

    // ── Update rolling diamond counter (performance opt) ──
    const oldLevel = agency.level;
    const updatedAgency = await tx.agency.update({
      where: { id: agency.id },
      data: {
        rollingDiamonds30d: { increment: giftDiamonds },
        lastRollingUpdate: new Date(),
      },
    });

    // ── Tier change detection (inside tx, event emitted AFTER commit — edge case C) ──
    const newTier = getAgencyTier(updatedAgency.rollingDiamonds30d);
    if (oldLevel !== newTier.level) {
      await tx.agency.update({
        where: { id: agency.id },
        data: { level: newTier.level as any },
      });
      tierChanges.push({
        agencyId: agency.id,
        oldLevel,
        newLevel: newTier.level,
      });
    }

    this.logger.log(
      `Commission: ${commissionDiamonds} diamonds to agency ${agency.id} ` +
      `(rate: ${(effectiveRate * 100).toFixed(1)}%, gift: ${giftDiamonds})`,
    );

    // Continue up the hierarchy
    if (agency.parentAgencyId) {
      await this.creditCommissionUpward(
        agency.parentAgencyId,
        hostUserId,
        giftDiamonds,
        originalTransactionId,
        agencyId,
        tx,
        tierChanges,
      );
    }
  }

  // ──────────────────────────────────────────
  // Reversal Logic (Atomic, Idempotent)
  // ──────────────────────────────────────────

  /**
   * Reverse all agency commission for a given chat payment transaction.
   * Called when a chat payment is reversed/refunded.
   *
   * Guarantees:
   * - Idempotent: calling twice for same tx is a no-op (edge case B)
   * - Negative-safe: blocks if agency owner has insufficient diamonds (edge case E)
   * - Atomic: all reversals in one DB transaction
   */
  async reverseChatPaymentCommission(originalTransactionId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Find all original commission logs for this transaction
        const commissionLogs = await tx.agencyCommissionLog.findMany({
          where: {
            originalTransactionId,
            isReversal: false,
          },
        });

        if (commissionLogs.length === 0) {
          this.logger.warn(
            `No commission logs found for transaction ${originalTransactionId}`,
          );
          return;
        }

        for (const log of commissionLogs) {
          // ── Reversal idempotency (edge case B) ──
          const existingReversal = await tx.agencyCommissionLog.findUnique({
            where: {
              agencyId_originalTransactionId_isReversal: {
                agencyId: log.agencyId,
                originalTransactionId,
                isReversal: true,
              },
            },
          });

          if (existingReversal) {
            this.logger.warn(
              `Reversal already exists for agency ${log.agencyId}, tx ${originalTransactionId}`,
            );
            continue;
          }

          // Get agency to find owner
          const agency = await tx.agency.findUnique({
            where: { id: log.agencyId },
          });
          if (!agency) continue;

          // ── Row-level lock + negative balance check (edge case E) ──
          const wallets = await tx.$queryRaw<
            Array<{ id: string; userId: string; diamonds: number }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${agency.ownerId}::uuid FOR UPDATE`,
          );

          const wallet = wallets[0];
          if (!wallet) {
            throw new BadRequestException(
              `Wallet not found for agency owner ${agency.ownerId}`,
            );
          }

          if (wallet.diamonds < log.diamondsEarned) {
            throw new BadRequestException(
              `Insufficient diamonds for reversal. Agency ${log.agencyId} owner has ${wallet.diamonds} diamonds, needs ${log.diamondsEarned}`,
            );
          }

          // Deduct commission diamonds
          await tx.wallet.update({
            where: { userId: agency.ownerId },
            data: { diamonds: { decrement: log.diamondsEarned } },
          });

          // Create reversal transaction record
          await tx.transaction.create({
            data: {
              type: TransactionType.AGENCY_COMMISSION_REVERSAL,
              senderId: agency.ownerId,
              diamondAmount: log.diamondsEarned,
              status: TransactionStatus.COMPLETED,
              description: `Commission reversal for tx ${originalTransactionId}`,
              metadata: {
                agencyId: log.agencyId,
                originalTransactionId,
                originalCommissionLogId: log.id,
              },
            },
          });

          // Create reversal commission log
          await tx.agencyCommissionLog.create({
            data: {
              agencyId: log.agencyId,
              originalTransactionId,
              sourceAgencyId: log.sourceAgencyId,
              hostId: log.hostId,
              giftDiamonds: log.giftDiamonds,
              commissionRate: log.commissionRate,
              subAgencyRate: log.subAgencyRate,
              effectiveRate: log.effectiveRate,
              diamondsEarned: -log.diamondsEarned,
              isReversal: true,
            },
          });

          // Decrement rolling counter
          await tx.agency.update({
            where: { id: log.agencyId },
            data: {
              rollingDiamonds30d: {
                decrement: Math.min(log.giftDiamonds, agency.rollingDiamonds30d),
              },
            },
          });

          this.logger.log(
            `Reversed ${log.diamondsEarned} commission diamonds from agency ${log.agencyId}`,
          );
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );
  }

  // ──────────────────────────────────────────
  // Dashboard & Analytics
  // ──────────────────────────────────────────

  /**
   * Get the direct sub-agencies total diamonds (each sub-agency individually)
   * to compute their individual commission rates.
   */
  async getSubAgencyDiamondBreakdown(agencyId: string): Promise<
    Array<{ subAgencyId: string; totalDiamonds: number; commissionRate: number }>
  > {
    const subAgencies = await this.prisma.agency.findMany({
      where: { parentAgencyId: agencyId, isBanned: false },
      select: { id: true, rollingDiamonds30d: true },
    });

    return subAgencies.map((sub) => ({
      subAgencyId: sub.id,
      totalDiamonds: sub.rollingDiamonds30d,
      commissionRate: getCommissionRate(sub.rollingDiamonds30d),
    }));
  }

  /**
   * Get agency dashboard with commission stats
   */
  async getAgencyDashboard(userId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { ownerId: userId },
      include: {
        subAgencies: {
          where: { isBanned: false },
          select: { id: true, name: true, level: true, rollingDiamonds30d: true },
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

    // Use cached rolling counter for fast tier lookup
    const totalDiamonds = agency.rollingDiamonds30d;
    const tier = getAgencyTier(totalDiamonds);

    // Sub-agency breakdown (uses cached counters too)
    const subAgencyBreakdown = await this.getSubAgencyDiamondBreakdown(agency.id);

    // Today's commission earnings
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayCommission = await this.prisma.agencyCommissionLog.aggregate({
      where: {
        agencyId: agency.id,
        isReversal: false,
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
        isReversal: false,
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
        isReversal: log.isReversal,
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

    // Emit WebSocket event after commit
    this.emitEvent('agencyBanned', agency.ownerId, {
      agencyId,
      isBanned,
    });

    return { success: true, isBanned };
  }

  // ──────────────────────────────────────────
  // WebSocket Event Helpers
  // ──────────────────────────────────────────

  /**
   * Emit agency events AFTER transaction commit (edge case C).
   * Uses the gateway reference injected by the module.
   */
  emitEvent(event: string, agencyOwnerId: string, data: any) {
    if (!this.gateway) return;
    try {
      this.gateway.emitToUser(agencyOwnerId, event, data);
    } catch (err) {
      this.logger.error(`Failed to emit ${event}: ${(err as Error).message}`);
    }
  }

  /**
   * Emit tier change events (called after commission tx commits)
   */
  emitTierChanges(tierChanges: Array<{ agencyId: string; oldLevel: string; newLevel: string }>) {
    for (const change of tierChanges) {
      this.emitEvent('agencyTierChanged', '', change);
    }
  }
}
