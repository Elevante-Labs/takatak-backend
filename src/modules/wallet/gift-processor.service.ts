import { Injectable, Logger, Optional } from '@nestjs/common';
import { HostGiftHandlerService } from '../host/host-gift-handler.service';

/**
 * Orchestrates post-gift-transaction side effects.
 *
 * When a host receives diamonds from a gift (chat payment),
 * this service triggers:
 * 1. Host daily/weekly stat recording (for salary tier tracking)
 *
 * NOTE: Agency commission is NO LONGER fire-and-forget.
 * It is now processed INSIDE the main wallet transaction
 * for financial safety. See wallet.service.ts processChatPayment.
 */
@Injectable()
export class GiftProcessorService {
  private readonly logger = new Logger(GiftProcessorService.name);

  constructor(
    @Optional() private readonly hostGiftHandler: HostGiftHandlerService,
  ) { }

  /**
   * Process non-financial side effects after a host receives a gift.
   * Called after the main chat payment transaction commits.
   *
   * Commission is handled inside the main transaction now.
   * This only handles host stat recording.
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
  }
}
