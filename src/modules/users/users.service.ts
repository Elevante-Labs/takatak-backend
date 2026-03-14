import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpdateUserDto, AdminUpdateUserDto } from './dto';
import {
  getPaginationParams,
  buildPaginatedResult,
  PaginatedResult,
} from '../../common/utils/pagination.util';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        wallet: {
          select: {
            giftCoins: true,
            gameCoins: true,
            diamonds: true,
            promoDiamonds: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.sanitizeUser(user);
  }

  async findByPhone(phone: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    if (dto.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });

      if (existing && existing.id !== userId) {
        throw new ConflictException('Username already taken');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });

    return this.sanitizeUser(user);
  }

  async adminUpdateUser(userId: string, dto: AdminUpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        ...(dto.vipLevel !== undefined && dto.vipLevel > 0
          ? { vipExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } // 30 days
          : {}),
      },
    });

    this.logger.log(`Admin updated user ${userId}: ${JSON.stringify(dto)}`);
    return this.sanitizeUser(updated);
  }

  async listUsers(
    page?: number,
    limit?: number,
    role?: string,
  ): Promise<PaginatedResult<Partial<User>>> {
    const params = getPaginationParams(page, limit);

    const where = {
      deletedAt: null,
      ...(role ? { role: role as any } : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          username: true,
          role: true,
          vipLevel: true,
          country: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(users, total, params);
  }

  async softDelete(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`User soft deleted: ${userId}`);
    return { message: 'User deleted successfully' };
  }

  /**
   * Get all other active users available for chat (excludes the caller).
   * Returns USERs and HOSTs so both roles can discover each other.
   */
  async getChatPartners(currentUserId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = {
      id: { not: currentUserId },
      isActive: true,
      deletedAt: null,
      role: { in: ['USER' as any, 'HOST' as any] },
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          role: true,
          vipLevel: true,
          country: true,
          isVerified: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(users, total, params);
  }

  /**
   * Get online hosts sorted by promotion score.
   *
   * promotionScore =
   *   (totalDiamondsEarned * 0.5) +
   *   (totalMessages * 0.2) +
   *   (recentActivityScore * 0.3)
   *
   * If host.isVerified → score *= VERIFIED_BOOST_MULTIPLIER (default 1.5)
   */
  async getOnlineHosts(page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const hostWhere = {
      role: 'HOST' as any,
      isActive: true,
      deletedAt: null,
    };

    const total = await this.prisma.user.count({ where: hostWhere });

    // Fetch all active hosts with their stats
    const hosts = await this.prisma.user.findMany({
      where: hostWhere,
      select: {
        id: true,
        username: true,
        vipLevel: true,
        country: true,
        isVerified: true,
        createdAt: true,
      },
    });

    // Get verified boost multiplier from SystemSettings
    const boostSetting = await this.prisma.systemSettings.findUnique({
      where: { key: 'VERIFIED_BOOST_MULTIPLIER' },
    });
    const verifiedMultiplier = boostSetting
      ? parseFloat(boostSetting.value)
      : 1.5;

    // Calculate promotion scores in parallel
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const scored = await Promise.all(
      hosts.map(async (host) => {
        // Total diamonds earned (CHAT_PAYMENT completed, host is receiver)
        const diamondAgg = await this.prisma.transaction.aggregate({
          where: {
            receiverId: host.id,
            type: 'CHAT_PAYMENT',
            status: 'COMPLETED',
          },
          _sum: { diamondAmount: true },
        });
        const totalDiamonds = diamondAgg._sum?.diamondAmount || 0;

        // Total messages received
        const totalMessages = await this.prisma.message.count({
          where: {
            chat: {
              OR: [{ user1Id: host.id }, { user2Id: host.id }],
            },
            senderId: { not: host.id },
          },
        });

        // Recent activity: messages received in last 24h
        const recentMessages = await this.prisma.message.count({
          where: {
            chat: {
              OR: [{ user1Id: host.id }, { user2Id: host.id }],
            },
            senderId: { not: host.id },
            createdAt: { gte: oneDayAgo },
          },
        });

        // Normalize recent activity (cap at 100 for scoring)
        const recentActivityScore = Math.min(recentMessages, 100);

        let score =
          totalDiamonds * 0.5 +
          totalMessages * 0.2 +
          recentActivityScore * 0.3;

        if (host.isVerified) {
          score *= verifiedMultiplier;
        }

        return {
          id: host.id,
          username: host.username,
          vipLevel: host.vipLevel,
          country: host.country,
          isVerified: host.isVerified,
          promotionScore: Math.round(score * 100) / 100,
        };
      }),
    );

    // Sort by promotion score descending
    scored.sort((a, b) => b.promotionScore - a.promotionScore);

    // Paginate
    const start = (params.page - 1) * params.limit;
    const paged = scored.slice(start, start + params.limit);

    return buildPaginatedResult(paged, total, params);
  }

  private sanitizeUser(user: any) {
    const { deviceFingerprint, lastLoginIp, deletedAt, ...sanitized } = user;
    return sanitized;
  }
}
