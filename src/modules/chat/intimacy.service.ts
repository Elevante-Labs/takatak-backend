import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Intimacy Level System
 *
 * Points thresholds:
 *   Level 1:  0-59 points
 *   Level 2: 60-79 points
 *   Level 3: 80+ points
 *
 * Points are earned per message sent by the USER to a HOST.
 * Points earned depend on how fast messages are being exchanged:
 *   - < 1 min gap:  +3 points (rapid chatting)
 *   - < 5 min gap:  +2 points (active chatting)
 *   - < 30 min gap: +1 point  (moderate)
 *   - > 30 min gap: +0 points (slow / inactive, may decay)
 *
 * Decay: If gap > 2 hours, points decay by 2 per message cycle.
 *        If gap > 24 hours, points decay by 5.
 */

const LEVEL_THRESHOLDS = [
  { level: 1, minPoints: 0 },
  { level: 2, minPoints: 60 },
  { level: 3, minPoints: 80 },
];

@Injectable()
export class IntimacyService {
  private readonly logger = new Logger(IntimacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get or create the intimacy record for a user-host pair.
   */
  async getIntimacy(userId: string, hostId: string) {
    let intimacy = await this.prisma.intimacy.findUnique({
      where: { userId_hostId: { userId, hostId } },
    });

    if (!intimacy) {
      intimacy = await this.prisma.intimacy.create({
        data: { userId, hostId, points: 0, level: 1 },
      });
    }

    return intimacy;
  }

  /**
   * Update intimacy when a user sends a message to a host.
   * Returns the updated intimacy record.
   */
  async onMessageSent(userId: string, hostId: string) {
    const intimacy = await this.getIntimacy(userId, hostId);
    const now = new Date();
    const lastMsg = intimacy.lastMessageAt;

    let pointDelta = 0;

    if (!lastMsg) {
      // First message ever — give initial points
      pointDelta = 3;
    } else {
      const gapMs = now.getTime() - lastMsg.getTime();
      const gapMinutes = gapMs / (1000 * 60);

      if (gapMinutes < 1) {
        pointDelta = 3; // Rapid chatting
      } else if (gapMinutes < 5) {
        pointDelta = 2; // Active chatting
      } else if (gapMinutes < 30) {
        pointDelta = 1; // Moderate
      } else if (gapMinutes > 120) {
        // Decay: slow replies
        pointDelta = -2;
      }

      // Heavy decay for long absence
      if (gapMinutes > 1440) {
        // > 24 hours
        pointDelta = -5;
      }
    }

    const newPoints = Math.max(0, Math.min(100, intimacy.points + pointDelta));
    const newLevel = this.calculateLevel(newPoints);

    const updated = await this.prisma.intimacy.update({
      where: { id: intimacy.id },
      data: {
        points: newPoints,
        level: newLevel,
        lastMessageAt: now,
      },
    });

    if (newLevel !== intimacy.level) {
      this.logger.log(
        `Intimacy level changed: ${userId} ↔ ${hostId}: ${intimacy.level} → ${newLevel} (${newPoints} pts)`,
      );
    }

    return updated;
  }

  /**
   * Compute display info from an existing intimacy record (avoids extra DB query).
   */
  getDisplayInfo(record: { level: number; points: number }) {
    const nextLevel = LEVEL_THRESHOLDS.find((t) => t.level === record.level + 1);
    const currentMin = LEVEL_THRESHOLDS.find((t) => t.level === record.level)?.minPoints ?? 0;
    return {
      level: record.level,
      points: record.points,
      nextLevelAt: nextLevel?.minPoints ?? null,
      progressPercent: nextLevel
        ? Math.round(
            ((record.points - currentMin) / (nextLevel.minPoints - currentMin)) * 100,
          )
        : 100,
    };
  }

  private calculateLevel(points: number): number {
    let level = 1;
    for (const threshold of LEVEL_THRESHOLDS) {
      if (points >= threshold.minPoints) {
        level = threshold.level;
      }
    }
    return level;
  }

  /**
   * Get intimacy info for display (e.g., in chat header).
   */
  async getIntimacyInfo(userId: string, hostId: string) {
    const intimacy = await this.getIntimacy(userId, hostId);
    const nextLevel = LEVEL_THRESHOLDS.find((t) => t.level === intimacy.level + 1);

    return {
      level: intimacy.level,
      points: intimacy.points,
      nextLevelAt: nextLevel?.minPoints ?? null,
      progressPercent: nextLevel
        ? Math.round(
            ((intimacy.points - (LEVEL_THRESHOLDS.find((t) => t.level === intimacy.level)?.minPoints ?? 0)) /
              (nextLevel.minPoints - (LEVEL_THRESHOLDS.find((t) => t.level === intimacy.level)?.minPoints ?? 0))) *
              100,
          )
        : 100,
    };
  }
}
