import { Module } from '@nestjs/common';
import { GiftController } from './gift.controller';
import { GiftService } from './gift.service';
import { GiftAdminService } from './gift-admin.service';
import { GiftAdminController } from './gift-admin.controller';
import { GiftAnalyticsService } from './gift-analytics.service';
import { GiftAnalyticsController } from './gift-analytics.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [GiftController, GiftAdminController, GiftAnalyticsController],
  providers: [GiftService, GiftAdminService, GiftAnalyticsService],
  exports: [GiftService, GiftAdminService, GiftAnalyticsService],
})
export class GiftModule {}
