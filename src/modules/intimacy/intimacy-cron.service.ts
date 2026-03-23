import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IntimacyEngineService } from './intimacy.service';
import { RelationshipService } from './relationship.service';
import { DECAY_POINTS_PER_DAY } from './constants/intimacy.constants';

@Injectable()
export class IntimacyCronService {
  private readonly logger = new Logger(IntimacyCronService.name);

  constructor(
    private readonly intimacyEngine: IntimacyEngineService,
    private readonly relationshipService: RelationshipService,
  ) {}

  /**
   * Daily decay: reduce intimacy score for inactive pairs.
   * Runs every day at 3:00 AM UTC.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyDecay() {
    this.logger.log('Running daily intimacy decay...');

    try {
      const decayedCount = await this.intimacyEngine.applyDecay(
        DECAY_POINTS_PER_DAY,
      );
      this.logger.log(`Daily decay complete: ${decayedCount} records updated`);
    } catch (error) {
      this.logger.error(
        `Daily decay failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Expire stale relationships (no interaction for 7 days).
   * Runs every day at 4:00 AM UTC.
   */
  @Cron('0 4 * * *')
  async handleRelationshipExpiry() {
    this.logger.log('Running relationship expiry check...');

    try {
      const expiredCount =
        await this.relationshipService.expireStaleRelationships();
      this.logger.log(
        `Relationship expiry complete: ${expiredCount} relationships expired`,
      );
    } catch (error) {
      this.logger.error(
        `Relationship expiry failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
