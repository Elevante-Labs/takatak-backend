import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { FraudFlagType } from '@prisma/client';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';

interface FraudFlagData {
  type: string;
  description: string;
  chatId?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check message rate limit for a user.
   * Uses Redis INCR + conditional EXPIRE.
   *
   * FIXED: The original INCR-then-EXPIRE had a race condition:
   * if the process crashed between INCR (returning 1) and EXPIRE,
   * the key would persist forever, permanently blocking the user.
   * Now uses a Lua script for atomic INCR + EXPIRE-if-new.
   */
  async checkMessageRateLimit(userId: string): Promise<void> {
    const maxPerMinute = this.configService.get<number>('fraud.maxMessagesPerMinute') || 30;
    const key = `rate:msg:${userId}`;

    // Atomic: increment and set TTL only if the key is new
    const client = this.redis.getClient();
    const current = await client.eval(
      `local c = redis.call('INCR', KEYS[1])
       if c == 1 then redis.call('EXPIRE', KEYS[1], 60) end
       return c`,
      1,
      key,
    ) as number;

    if (current > maxPerMinute) {
      await this.flagSuspiciousActivity(userId, {
        type: 'RATE_ABUSE',
        description: `Message rate limit exceeded: ${current}/${maxPerMinute} per minute`,
      });
      throw new BadRequestException('Message rate limit exceeded. Slow down.');
    }
  }

  /**
   * Flag suspicious activity — logs and records, does NOT auto-ban.
   */
  async flagSuspiciousActivity(userId: string, data: FraudFlagData) {
    const flagType = this.mapToFraudFlagType(data.type);

    const flag = await this.prisma.fraudFlag.create({
      data: {
        userId,
        type: flagType,
        description: data.description,
        ipAddress: data.ipAddress,
        deviceFingerprint: data.deviceFingerprint,
        metadata: {
          chatId: data.chatId,
          ...data.metadata,
        } as any,
      },
    });

    this.logger.warn(
      `FRAUD FLAG [${data.type}] User ${userId}: ${data.description} (flag: ${flag.id})`,
    );

    return flag;
  }

  /**
   * Check for multiple accounts on same device.
   * Also returns the other account IDs for cross-referencing with referral chains.
   */
  async checkMultiAccountByDevice(
    deviceFingerprint: string,
    currentUserId: string,
  ): Promise<{ flagged: boolean; otherAccountIds: string[] }> {
    if (!deviceFingerprint) return { flagged: false, otherAccountIds: [] };

    const maxAccounts = this.configService.get<number>('fraud.maxAccountsPerDevice') || 2;

    const otherAccounts = await this.prisma.user.findMany({
      where: {
        deviceFingerprint,
        id: { not: currentUserId },
        deletedAt: null,
      },
      select: { id: true },
    });

    const otherAccountIds = otherAccounts.map((a) => a.id);

    if (otherAccounts.length >= maxAccounts) {
      await this.flagSuspiciousActivity(currentUserId, {
        type: 'MULTI_ACCOUNT',
        description: `Device fingerprint ${deviceFingerprint} has ${otherAccounts.length + 1} accounts (max: ${maxAccounts})`,
        deviceFingerprint,
        metadata: { otherAccountIds },
      });
      return { flagged: true, otherAccountIds };
    }

    return { flagged: false, otherAccountIds };
  }

  /**
   * Detect self-chat by checking device fingerprints.
   */
  async detectSelfChat(
    user1Id: string,
    user2Id: string,
  ): Promise<boolean> {
    const [user1, user2] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user1Id },
        select: { deviceFingerprint: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user2Id },
        select: { deviceFingerprint: true },
      }),
    ]);

    if (
      user1?.deviceFingerprint &&
      user2?.deviceFingerprint &&
      user1.deviceFingerprint === user2.deviceFingerprint
    ) {
      await this.flagSuspiciousActivity(user1Id, {
        type: 'SELF_CHAT',
        description: 'Same device fingerprint on both chat participants',
        metadata: { otherUserId: user2Id },
      });
      return true;
    }

    return false;
  }

  /**
   * Log IP for fraud tracking.
   */
  async logIpActivity(userId: string, ip: string) {
    const key = `ip:${userId}`;
    const existingIps = await this.redis.get(key);

    const ipSet: Set<string> = existingIps
      ? new Set(JSON.parse(existingIps))
      : new Set();

    ipSet.add(ip);

    // Flag if too many different IPs in short time
    if (ipSet.size > 10) {
      await this.flagSuspiciousActivity(userId, {
        type: 'SUSPICIOUS_PATTERN',
        description: `User logged in from ${ipSet.size} different IPs`,
        ipAddress: ip,
      });
    }

    await this.redis.set(key, JSON.stringify([...ipSet]), 86400); // 24h
  }

  /**
   * Get fraud flags for admin review.
   */
  async getFraudFlags(
    page?: number,
    limit?: number,
    type?: string,
    resolved?: boolean,
  ) {
    const params = getPaginationParams(page, limit);

    const where = {
      ...(type ? { type: type as FraudFlagType } : {}),
      ...(resolved !== undefined ? { resolved } : {}),
    };

    const [flags, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, phone: true, username: true, role: true },
          },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    return buildPaginatedResult(flags, total, params);
  }

  /**
   * Resolve a fraud flag.
   */
  async resolveFraudFlag(flagId: string) {
    const flag = await this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: { resolved: true },
    });

    this.logger.log(`Fraud flag resolved: ${flagId}`);
    return flag;
  }

  /**
   * Get fraud summary for a user.
   */
  async getUserFraudSummary(userId: string) {
    const flags = await this.prisma.fraudFlag.groupBy({
      by: ['type'],
      where: { userId },
      _count: true,
    });

    const total = await this.prisma.fraudFlag.count({
      where: { userId },
    });

    return {
      userId,
      totalFlags: total,
      flagsByType: flags.reduce(
        (acc, f) => ({ ...acc, [f.type]: f._count }),
        {},
      ),
    };
  }

  private mapToFraudFlagType(type: string): FraudFlagType {
    const mapping: Record<string, FraudFlagType> = {
      MULTI_ACCOUNT: FraudFlagType.MULTI_ACCOUNT,
      SELF_CHAT: FraudFlagType.SELF_CHAT,
      RATE_ABUSE: FraudFlagType.RATE_ABUSE,
      DEVICE_ANOMALY: FraudFlagType.DEVICE_ANOMALY,
      SUSPICIOUS_PATTERN: FraudFlagType.SUSPICIOUS_PATTERN,
    };

    return mapping[type] || FraudFlagType.SUSPICIOUS_PATTERN;
  }
}
