import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import {
  LEVEL_THRESHOLDS,
  DAILY_CHAT_ROUND_CAP,
  CHAT_XP_PER_ROUND,
  REPLY_SPEED_TIERS,
  FRESHNESS_TIERS,
} from './constants/intimacy.constants';
import { InteractionType } from './dto/track-interaction.dto';

@Injectable()
export class IntimacyEngineService {
  private readonly logger = new Logger(IntimacyEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Normalize pair ordering to prevent duplicate records.
   * Always ensures userAId < userBId.
   */
  normalizePair(userId1: string, userId2: string): [string, string] {
    return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
  }

  /**
   * Get or create the intimacy record for a user pair.
   */
  async getOrCreateIntimacy(userId1: string, userId2: string) {
    const [userAId, userBId] = this.normalizePair(userId1, userId2);

    let intimacy = await this.prisma.intimacy.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    if (!intimacy) {
      intimacy = await this.prisma.intimacy.create({
        data: { userAId, userBId },
      });
    }

    return intimacy;
  }

  /**
   * Get intimacy between two users (returns null if none).
   */
  async getIntimacy(userId1: string, userId2: string) {
    const [userAId, userBId] = this.normalizePair(userId1, userId2);

    // Try Redis cache first
    const cacheKey = `intimacy:${userAId}:${userBId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const intimacy = await this.prisma.intimacy.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: { relationship: true },
    });

    if (intimacy) {
      await this.redis.set(cacheKey, JSON.stringify(intimacy), 300); // 5 min cache
    }

    return intimacy;
  }

  /**
   * Core interaction tracking engine.
   *
   * Calculates XP based on:
   * - Chat rounds (capped at 30/day, +1 per round)
   * - Reply speed scoring
   * - Gift value
   * - Freshness multiplier
   *
   * Returns: { intimacy, xpEarned, leveledUp, newLevel }
   */
  async trackInteraction(
    userA: string,
    userB: string,
    type: InteractionType,
    metadata?: {
      replySpeedMs?: number;
      giftCoins?: number;
      extra?: Record<string, any>;
    },
  ) {
    if (userA === userB) {
      throw new BadRequestException('Cannot track self-interaction');
    }

    const intimacy = await this.getOrCreateIntimacy(userA, userB);
    const now = new Date();

    let rawXp = 0;

    switch (type) {
      case InteractionType.CHAT:
        rawXp = this.calculateChatXp(intimacy, now, metadata?.replySpeedMs);
        break;
      case InteractionType.GIFT:
        rawXp = this.calculateGiftXp(metadata?.giftCoins || 0);
        break;
      case InteractionType.CALL:
        rawXp = 5; // Base call XP
        break;
      case InteractionType.ROOM:
        rawXp = 3; // Base room XP
        break;
    }

    // Apply freshness multiplier
    const freshness = this.getFreshnessMultiplier(intimacy.lastInteractionAt);
    const totalXp = Math.floor(rawXp * freshness);

    if (totalXp === 0) {
      return {
        intimacy,
        xpEarned: 0,
        leveledUp: false,
        newLevel: intimacy.level,
      };
    }

    const newScore = intimacy.intimacyScore + totalXp;
    const newLevel = this.calculateLevel(newScore);
    const leveledUp = newLevel > intimacy.level;

    // Update daily chat counter
    const todayStr = now.toISOString().slice(0, 10);
    const intimacyDate = intimacy.dailyChatDate
      ? intimacy.dailyChatDate.toISOString().slice(0, 10)
      : null;
    const isNewDay = intimacyDate !== todayStr;

    const updatedIntimacy = await this.prisma.intimacy.update({
      where: { id: intimacy.id },
      data: {
        intimacyScore: newScore,
        level: newLevel,
        lastInteractionAt: now,
        dailyChatRounds:
          type === InteractionType.CHAT
            ? isNewDay
              ? 1
              : intimacy.dailyChatRounds + 1
            : intimacy.dailyChatRounds,
        dailyChatDate:
          type === InteractionType.CHAT
            ? now
            : intimacy.dailyChatDate,
      },
    });

    // Log the interaction
    await this.prisma.intimacyLog.create({
      data: {
        intimacyId: intimacy.id,
        actionType: type,
        value: totalXp,
        metadata: metadata?.extra ?? undefined,
      },
    });

    // Invalidate cache
    const [normA, normB] = this.normalizePair(userA, userB);
    await this.redis.del(`intimacy:${normA}:${normB}`);

    if (leveledUp) {
      this.logger.log(
        `Level UP: ${userA} ↔ ${userB}: L${intimacy.level} → L${newLevel} (score: ${newScore})`,
      );
    }

    return {
      intimacy: updatedIntimacy,
      xpEarned: totalXp,
      leveledUp,
      newLevel,
      previousLevel: intimacy.level,
    };
  }

  /**
   * Calculate chat XP with daily round cap and reply speed bonus.
   */
  private calculateChatXp(
    intimacy: { dailyChatRounds: number; dailyChatDate: Date | null },
    now: Date,
    replySpeedMs?: number,
  ): number {
    const todayStr = now.toISOString().slice(0, 10);
    const intimacyDate = intimacy.dailyChatDate
      ? intimacy.dailyChatDate.toISOString().slice(0, 10)
      : null;
    const isNewDay = intimacyDate !== todayStr;

    const currentRounds = isNewDay ? 0 : intimacy.dailyChatRounds;

    // Cap check
    if (currentRounds >= DAILY_CHAT_ROUND_CAP) {
      return 0;
    }

    let xp = CHAT_XP_PER_ROUND;

    // Reply speed bonus
    if (replySpeedMs !== undefined && replySpeedMs >= 0) {
      for (const tier of REPLY_SPEED_TIERS) {
        if (replySpeedMs <= tier.maxMs) {
          xp += tier.xp;
          break;
        }
      }
    }

    return xp;
  }

  /**
   * Calculate gift XP based on coins spent.
   * 1 coin = 1 XP base
   */
  private calculateGiftXp(coins: number): number {
    return Math.max(0, Math.floor(coins));
  }

  /**
   * Get freshness multiplier based on days since last interaction.
   */
  private getFreshnessMultiplier(lastInteractionAt: Date | null): number {
    if (!lastInteractionAt) return 2.0; // First interaction = max freshness

    const daysSince =
      (Date.now() - lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24);

    for (const tier of FRESHNESS_TIERS) {
      if (daysSince <= tier.maxDays) {
        return tier.multiplier;
      }
    }

    return 0.5;
  }

  /**
   * Calculate level from score using thresholds.
   */
  calculateLevel(score: number): number {
    let level = 0;
    for (const threshold of LEVEL_THRESHOLDS) {
      if (score >= threshold.minScore) {
        level = threshold.level;
      }
    }
    return level;
  }

  /**
   * Get display info for the intimacy between two users.
   */
  async getIntimacyInfo(userId1: string, userId2: string) {
    const intimacy = await this.getIntimacy(userId1, userId2);

    if (!intimacy) {
      return {
        level: 0,
        score: 0,
        nextLevelAt: LEVEL_THRESHOLDS[1]?.minScore ?? null,
        progressPercent: 0,
        relationshipType: 'NONE',
        relationship: null,
      };
    }

    const currentThreshold =
      LEVEL_THRESHOLDS.find((t) => t.level === intimacy.level) ??
      LEVEL_THRESHOLDS[0];
    const nextThreshold = LEVEL_THRESHOLDS.find(
      (t) => t.level === intimacy.level + 1,
    );

    const progressPercent = nextThreshold
      ? Math.min(
          100,
          Math.round(
            ((intimacy.intimacyScore - currentThreshold.minScore) /
              (nextThreshold.minScore - currentThreshold.minScore)) *
              100,
          ),
        )
      : 100;

    return {
      level: intimacy.level,
      score: intimacy.intimacyScore,
      nextLevelAt: nextThreshold?.minScore ?? null,
      progressPercent,
      relationshipType: intimacy.relationshipType,
      relationship: intimacy.relationship || null,
      lastInteractionAt: intimacy.lastInteractionAt,
    };
  }

  /**
   * Get all level thresholds for frontend display.
   */
  getLevelThresholds() {
    return LEVEL_THRESHOLDS.map((t) => ({
      level: t.level,
      minScore: t.minScore,
    }));
  }

  /**
   * Apply daily decay to inactive intimacies.
   * Called by the cron service.
   */
  async applyDecay(decayPoints: number): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    // Find all intimacies with no interaction in the last 24h
    const staleIntimacies = await this.prisma.intimacy.findMany({
      where: {
        isActive: true,
        intimacyScore: { gt: 0 },
        OR: [
          { lastInteractionAt: { lt: cutoff } },
          { lastInteractionAt: null },
        ],
      },
      select: { id: true, intimacyScore: true, level: true },
    });

    if (staleIntimacies.length === 0) return 0;

    // Batch update — reduce score, recalculate levels
    let decayedCount = 0;
    for (const record of staleIntimacies) {
      const newScore = Math.max(0, record.intimacyScore - decayPoints);
      const newLevel = this.calculateLevel(newScore);

      await this.prisma.intimacy.update({
        where: { id: record.id },
        data: {
          intimacyScore: newScore,
          level: newLevel,
        },
      });

      // Invalidate cache
      await this.redis.del(`intimacy:${record.id}`);
      decayedCount++;
    }

    return decayedCount;
  }
}
