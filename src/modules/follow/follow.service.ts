import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';

@Injectable()
export class FollowService {
  private readonly logger = new Logger(FollowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Follow a user.
   */
  async follow(followerId: string, followeeId: string) {
    if (followerId === followeeId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    // Ensure target user exists
    const target = await this.prisma.user.findUnique({
      where: { id: followeeId },
      select: { id: true },
    });

    if (!target) {
      throw new NotFoundException('User not found');
    }

    // Check for existing follow
    const existing = await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId,
          followeeId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Already following this user');
    }

    const follow = await this.prisma.follow.create({
      data: { followerId, followeeId },
    });

    this.logger.log(`User ${followerId} followed ${followeeId}`);
    return follow;
  }

  /**
   * Unfollow a user.
   */
  async unfollow(followerId: string, followeeId: string) {
    if (followerId === followeeId) {
      throw new BadRequestException('Cannot unfollow yourself');
    }

    const existing = await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId,
          followeeId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Not following this user');
    }

    await this.prisma.follow.delete({
      where: {
        followerId_followeeId: {
          followerId,
          followeeId,
        },
      },
    });

    this.logger.log(`User ${followerId} unfollowed ${followeeId}`);
    return { success: true };
  }

  /**
   * Get followers of a user.
   */
  async getFollowers(userId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = { followeeId: userId };

    const [follows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              role: true,
              isVerified: true,
            },
          },
        },
      }),
      this.prisma.follow.count({ where }),
    ]);

    const data = follows.map((f) => f.follower);
    return buildPaginatedResult(data, total, params);
  }

  /**
   * Get users that a user is following.
   */
  async getFollowing(userId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = { followerId: userId };

    const [follows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          followee: {
            select: {
              id: true,
              username: true,
              role: true,
              isVerified: true,
            },
          },
        },
      }),
      this.prisma.follow.count({ where }),
    ]);

    const data = follows.map((f) => f.followee);
    return buildPaginatedResult(data, total, params);
  }

  /**
   * Check if user A follows user B.
   */
  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId,
          followeeId,
        },
      },
    });
    return !!follow;
  }
}
