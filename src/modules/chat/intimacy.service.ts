import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Legacy Intimacy Service (kept for backward compatibility with /chat/intimacy/:otherUserId).
 *
 * The new, full-featured intimacy system lives in src/modules/intimacy/.
 * This service adapts the new DB schema (userAId/userBId, intimacyScore)
 * to the legacy API response format.
 */

@Injectable()
export class IntimacyService {
  private readonly logger = new Logger(IntimacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalize pair ordering (userAId < userBId) to match unique constraint.
   */
  private normalizePair(userId: string, hostId: string): [string, string] {
    return userId < hostId ? [userId, hostId] : [hostId, userId];
  }

  /**
   * Get or create the intimacy record for a user pair.
   */
  async getIntimacy(userId: string, hostId: string) {
    const [userAId, userBId] = this.normalizePair(userId, hostId);

    let intimacy = await this.prisma.intimacy.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    if (!intimacy) {
      intimacy = await this.prisma.intimacy.create({
        data: { userAId, userBId, intimacyScore: 0, level: 0 },
      });
    }

    return intimacy;
  }

  /**
   * Update intimacy when a user sends a message to a host (legacy flow).
   */
  async onMessageSent(userId: string, hostId: string) {
    const intimacy = await this.getIntimacy(userId, hostId);
    const now = new Date();
    const lastMsg = intimacy.lastInteractionAt;

    let pointDelta = 0;

    if (!lastMsg) {
      pointDelta = 3;
    } else {
      const gapMs = now.getTime() - lastMsg.getTime();
      const gapMinutes = gapMs / (1000 * 60);

      if (gapMinutes < 1) {
        pointDelta = 3;
      } else if (gapMinutes < 5) {
        pointDelta = 2;
      } else if (gapMinutes < 30) {
        pointDelta = 1;
      } else if (gapMinutes > 120) {
        pointDelta = -2;
      }

      if (gapMinutes > 1440) {
        pointDelta = -5;
      }
    }

    const newScore = Math.max(0, intimacy.intimacyScore + pointDelta);

    const updated = await this.prisma.intimacy.update({
      where: { id: intimacy.id },
      data: {
        intimacyScore: newScore,
        lastInteractionAt: now,
      },
    });

    return updated;
  }

  /**
   * Compute display info from an existing intimacy record.
   */
  getDisplayInfo(record: { level: number; intimacyScore: number }) {
    return {
      level: record.level,
      points: record.intimacyScore,
      nextLevelAt: null,
      progressPercent: 100,
    };
  }

  /**
   * Get intimacy info for display (e.g., in chat header).
   */
  async getIntimacyInfo(userId: string, hostId: string) {
    const intimacy = await this.getIntimacy(userId, hostId);

    return {
      level: intimacy.level,
      points: intimacy.intimacyScore,
      nextLevelAt: null,
      progressPercent: 100,
    };
  }
}
