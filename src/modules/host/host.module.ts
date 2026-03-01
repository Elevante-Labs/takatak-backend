import { Module } from '@nestjs/common';
import { HostDashboardController } from './host-dashboard.controller';
import { HostDashboardService } from './host-dashboard.service';

@Module({
  controllers: [HostDashboardController],
  providers: [HostDashboardService],
})
export class HostModule {}
