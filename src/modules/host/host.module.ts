import { Module } from '@nestjs/common';
import { HostDashboardController } from './host-dashboard.controller';
import { HostDashboardService } from './host-dashboard.service';
import { HostRewardController } from './host-reward.controller';
import { HostRewardService } from './host-reward.service';
import { HostGiftHandlerService } from './host-gift-handler.service';

@Module({
  controllers: [HostDashboardController, HostRewardController],
  providers: [HostDashboardService, HostRewardService, HostGiftHandlerService],
  exports: [HostRewardService, HostGiftHandlerService],
})
export class HostModule {}
