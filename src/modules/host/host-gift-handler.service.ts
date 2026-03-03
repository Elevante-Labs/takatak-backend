import { Injectable, Logger } from '@nestjs/common';
import { HostRewardService } from './host-reward.service';

/**
 * Handles the downstream effects of a host receiving gift diamonds.
 * Called after a chat payment / gift transaction completes.
 *
 * Responsibilities:
 * 1. Record gift income in host daily/weekly stats
 * 2. Trigger agency commission calculation (done separately in AgencyService)
 *
 * NOTE: Agency commission is triggered separately. This service
 * only handles host-side stat tracking.
 */
@Injectable()
export class HostGiftHandlerService {
  private readonly logger = new Logger(HostGiftHandlerService.name);

  constructor(private readonly hostRewardService: HostRewardService) {}

  /**
   * Called when a host receives diamonds from a gift.
   * Records the income in daily/weekly stats for salary tier calculation.
   */
  async onGiftReceived(hostUserId: string, diamonds: number): Promise<void> {
    try {
      await this.hostRewardService.recordGiftIncome(hostUserId, diamonds);
      this.logger.debug(
        `Gift income recorded: ${diamonds} diamonds for host ${hostUserId}`,
      );
    } catch (error) {
      // Don't fail the gift transaction if stat recording fails
      this.logger.error(
        `Failed to record gift income for host ${hostUserId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Called when a host ends a live session.
   * Records accumulated live minutes.
   */
  async onLiveSessionEnd(hostUserId: string, durationMinutes: number): Promise<void> {
    try {
      await this.hostRewardService.recordLiveMinutes(hostUserId, durationMinutes);
      this.logger.debug(
        `Live minutes recorded: ${durationMinutes} min for host ${hostUserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record live minutes for host ${hostUserId}: ${(error as Error).message}`,
      );
    }
  }
}
