import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { IntimacyEngineService } from './intimacy.service';
import { FeatureGateService } from './feature-gate.service';
import {
  MAX_COUPLE_RELATIONSHIPS,
  MAX_BEST_FRIEND_RELATIONSHIPS,
  REACTIVATION_COST_PER_LEVEL,
  RELATIONSHIP_GIFT_EXPIRY_DAYS,
} from './constants/intimacy.constants';

@Injectable()
export class RelationshipService {
  private readonly logger = new Logger(RelationshipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly intimacyEngine: IntimacyEngineService,
    private readonly featureGate: FeatureGateService,
  ) {}

  /**
   * Send a relationship invite (couple or friend).
   * Requires intimacy level 6+.
   */
  async sendInvite(
    inviterId: string,
    inviteeId: string,
    type: 'COUPLE' | 'FRIEND',
  ) {
    if (inviterId === inviteeId) {
      throw new BadRequestException('Cannot send invite to yourself');
    }

    // Check intimacy level requirement
    await this.featureGate.enforceFeatureAccess(
      inviterId,
      inviteeId,
      'relationship',
    );

    const intimacy = await this.intimacyEngine.getOrCreateIntimacy(
      inviterId,
      inviteeId,
    );

    // Check for existing active relationship
    const existing = await this.prisma.relationship.findUnique({
      where: { intimacyId: intimacy.id },
    });

    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictException('An active relationship already exists');
    }

    if (existing && existing.status === 'PENDING') {
      throw new ConflictException('A pending invite already exists');
    }

    // Couple constraint: max 1 active couple
    if (type === 'COUPLE') {
      await this.validateCoupleConstraint(inviterId);
      await this.validateCoupleConstraint(inviteeId);
    }

    // Friend constraint: max N active best friends
    if (type === 'FRIEND') {
      await this.validateFriendConstraint(inviterId);
    }

    // Upsert the relationship (in case there's an expired/rejected one)
    const relationship = existing
      ? await this.prisma.relationship.update({
          where: { id: existing.id },
          data: {
            type,
            inviterId,
            inviteeId,
            status: 'PENDING',
            startedAt: null,
            expiresAt: null,
          },
        })
      : await this.prisma.relationship.create({
          data: {
            intimacyId: intimacy.id,
            type,
            inviterId,
            inviteeId,
            status: 'PENDING',
          },
        });

    this.logger.log(
      `Relationship invite sent: ${inviterId} → ${inviteeId} (${type})`,
    );

    return relationship;
  }

  /**
   * Accept a relationship invite.
   */
  async acceptInvite(relationshipId: string, userId: string) {
    const relationship = await this.prisma.relationship.findUnique({
      where: { id: relationshipId },
      include: { intimacy: true },
    });

    if (!relationship) {
      throw new NotFoundException('Relationship invite not found');
    }

    if (relationship.status !== 'PENDING') {
      throw new BadRequestException('Invite is no longer pending');
    }

    if (relationship.inviteeId !== userId) {
      throw new BadRequestException('Only the invitee can accept this invite');
    }

    // Re-validate couple constraint at acceptance time
    if (relationship.type === 'COUPLE') {
      await this.validateCoupleConstraint(relationship.inviterId);
      await this.validateCoupleConstraint(relationship.inviteeId);
    }

    const now = new Date();
    const updated = await this.prisma.relationship.update({
      where: { id: relationshipId },
      data: {
        status: 'ACTIVE',
        startedAt: now,
      },
    });

    // Update intimacy relationship type
    const relType = relationship.type === 'COUPLE' ? 'COUPLE' : 'FRIEND';
    await this.prisma.intimacy.update({
      where: { id: relationship.intimacyId },
      data: { relationshipType: relType },
    });

    // Invalidate cache
    const [normA, normB] = this.intimacyEngine.normalizePair(
      relationship.intimacy.userAId,
      relationship.intimacy.userBId,
    );
    await this.redis.del(`intimacy:${normA}:${normB}`);

    this.logger.log(
      `Relationship accepted: ${relationship.inviterId} ↔ ${relationship.inviteeId} (${relationship.type})`,
    );

    return updated;
  }

  /**
   * Reject a relationship invite.
   */
  async rejectInvite(relationshipId: string, userId: string) {
    const relationship = await this.prisma.relationship.findUnique({
      where: { id: relationshipId },
    });

    if (!relationship) {
      throw new NotFoundException('Relationship invite not found');
    }

    if (relationship.status !== 'PENDING') {
      throw new BadRequestException('Invite is no longer pending');
    }

    if (relationship.inviteeId !== userId) {
      throw new BadRequestException('Only the invitee can reject this invite');
    }

    const updated = await this.prisma.relationship.update({
      where: { id: relationshipId },
      data: { status: 'REJECTED' },
    });

    this.logger.log(
      `Relationship rejected: ${relationship.inviterId} → ${relationship.inviteeId}`,
    );

    return updated;
  }

  /**
   * Expire relationships where no gifts have been sent for N days.
   * Called by the cron service.
   */
  async expireStaleRelationships(): Promise<number> {
    const cutoff = new Date(
      Date.now() - RELATIONSHIP_GIFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    // Find active relationships whose intimacy has no recent interaction
    const stale = await this.prisma.relationship.findMany({
      where: {
        status: 'ACTIVE',
        intimacy: {
          lastInteractionAt: { lt: cutoff },
        },
      },
      include: { intimacy: true },
    });

    if (stale.length === 0) return 0;

    for (const rel of stale) {
      await this.prisma.relationship.update({
        where: { id: rel.id },
        data: { status: 'EXPIRED', expiresAt: new Date() },
      });

      await this.prisma.intimacy.update({
        where: { id: rel.intimacyId },
        data: { relationshipType: 'NONE' },
      });

      // Invalidate cache
      const [normA, normB] = this.intimacyEngine.normalizePair(
        rel.intimacy.userAId,
        rel.intimacy.userBId,
      );
      await this.redis.del(`intimacy:${normA}:${normB}`);

      this.logger.log(
        `Relationship expired: ${rel.intimacy.userAId} ↔ ${rel.intimacy.userBId}`,
      );
    }

    return stale.length;
  }

  /**
   * Reactivate an expired relationship.
   * Cost scales with the intimacy level.
   */
  async reactivateRelationship(userId: string, otherUserId: string) {
    const intimacy = await this.intimacyEngine.getIntimacy(userId, otherUserId);
    if (!intimacy) {
      throw new NotFoundException('No intimacy record found');
    }

    const relationship = await this.prisma.relationship.findUnique({
      where: { intimacyId: intimacy.id },
    });

    if (!relationship) {
      throw new NotFoundException('No relationship found');
    }

    if (relationship.status === 'ACTIVE') {
      throw new BadRequestException('Relationship is already active');
    }

    if (relationship.status !== 'EXPIRED') {
      throw new BadRequestException(
        'Only expired relationships can be reactivated',
      );
    }

    // Calculate reactivation cost
    const cost = Math.max(1, intimacy.level) * REACTIVATION_COST_PER_LEVEL;

    // Check user has enough coins
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const totalCoins = wallet.giftCoins + wallet.gameCoins;
    if (totalCoins < cost) {
      throw new BadRequestException(
        `Reactivation costs ${cost} coins. You have ${totalCoins}.`,
      );
    }

    // Deduct coins (prefer gameCoins first, then giftCoins)
    const gameDeduct = Math.min(wallet.gameCoins, cost);
    const giftDeduct = cost - gameDeduct;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: {
          gameCoins: { decrement: gameDeduct },
          giftCoins: { decrement: giftDeduct },
        },
      }),
      this.prisma.relationship.update({
        where: { id: relationship.id },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: null,
        },
      }),
      this.prisma.intimacy.update({
        where: { id: intimacy.id },
        data: {
          relationshipType: relationship.type === 'COUPLE' ? 'COUPLE' : 'FRIEND',
        },
      }),
      this.prisma.transaction.create({
        data: {
          type: 'CHAT_PAYMENT', // Reuse existing type for now
          senderId: userId,
          coinAmount: cost,
          status: 'COMPLETED',
          description: `Relationship reactivation (${relationship.type})`,
          metadata: {
            action: 'relationship_reactivation',
            relationshipId: relationship.id,
            otherUserId,
          },
        },
      }),
    ]);

    // Invalidate cache
    const [normA, normB] = this.intimacyEngine.normalizePair(
      userId,
      otherUserId,
    );
    await this.redis.del(`intimacy:${normA}:${normB}`);

    this.logger.log(
      `Relationship reactivated: ${userId} ↔ ${otherUserId} (cost: ${cost} coins)`,
    );

    return { cost, relationship };
  }

  /**
   * Validate couple constraint: max 1 active couple.
   */
  private async validateCoupleConstraint(userId: string) {
    const activeCouples = await this.prisma.relationship.count({
      where: {
        type: 'COUPLE',
        status: 'ACTIVE',
        OR: [{ inviterId: userId }, { inviteeId: userId }],
      },
    });

    if (activeCouples >= MAX_COUPLE_RELATIONSHIPS) {
      throw new ConflictException(
        `Maximum ${MAX_COUPLE_RELATIONSHIPS} active couple relationship(s) allowed`,
      );
    }
  }

  /**
   * Validate friend constraint: max N active best friends.
   */
  private async validateFriendConstraint(userId: string) {
    const activeFriends = await this.prisma.relationship.count({
      where: {
        type: 'FRIEND',
        status: 'ACTIVE',
        OR: [{ inviterId: userId }, { inviteeId: userId }],
      },
    });

    if (activeFriends >= MAX_BEST_FRIEND_RELATIONSHIPS) {
      throw new ConflictException(
        `Maximum ${MAX_BEST_FRIEND_RELATIONSHIPS} active best friend relationship(s) allowed`,
      );
    }
  }
}
