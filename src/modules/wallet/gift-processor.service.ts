import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { AgencyService } from '../agency/agency.service';
import { HostGiftHandlerService } from '../host/host-gift-handler.service';

/**
 * Orchestrates post-gift-transaction side effects.
 *
 * When a host receives diamonds from a gift (chat payment),
 * this service triggers:
 * 1. Host daily/weekly stat recording (for salary tier tracking)
 * 2. Agency commission calculation and crediting
 *
 * These operations are fire-and-forget and should NOT fail the
 * original gift transaction.
 */
@Injectable()
export class GiftProcessorService {
  private readonly logger = new Logger(GiftProcessorService.name);

  constructor(
    @Optional() private readonly agencyService: AgencyService,
    @Optional() private readonly hostGiftHandler: HostGiftHandlerService,
  ) {}

  /**
   * Process all side effects after a host receives a gift.
   * Called after the main chat payment transaction commits.
   */
  async processGiftSideEffects(
    hostUserId: string,
    giftDiamonds: number,
  ): Promise<void> {
    // Fire-and-forget: record host stats
    if (this.hostGiftHandler) {
      this.hostGiftHandler.onGiftReceived(hostUserId, giftDiamonds).catch((err) => {
        this.logger.error(
          `Failed host stat recording for ${hostUserId}: ${err.message}`,
        );
      });
    }

    // Fire-and-forget: process agency commission
    if (this.agencyService) {
      this.agencyService.processGiftCommission(hostUserId, giftDiamonds).catch((err) => {
        this.logger.error(
          `Failed agency commission for ${hostUserId}: ${err.message}`,
        );
      });
    }
  }
}
