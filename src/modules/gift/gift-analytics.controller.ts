import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GiftAnalyticsService } from './gift-analytics.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('admin/gifts/analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN' as any)
export class GiftAnalyticsController {
  private readonly logger = new Logger(GiftAnalyticsController.name);

  constructor(private readonly analyticsService: GiftAnalyticsService) {}

  /**
   * GET /admin/gifts/analytics/metrics
   * Get overall gift metrics
   */
  @Get('metrics')
  async getMetrics() {
    return this.analyticsService.getMetrics();
  }

  /**
   * GET /admin/gifts/analytics/timeline
   * Get gift metrics by date range
   */
  @Get('timeline')
  async getMetricsByDateRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.analyticsService.getMetricsByDateRange(
      new Date(startDate),
      new Date(endDate),
    );
  }

  /**
   * GET /admin/gifts/analytics/gifters/leaderboard
   * Get top gifters leaderboard
   */
  @Get('gifters/leaderboard')
  async getTopGiftersLeaderboard(@Query('limit') limit?: string) {
    return this.analyticsService.getTopGiftersLeaderboard(
      limit ? parseInt(limit, 10) : 100,
    );
  }

  /**
   * GET /admin/gifts/analytics/gifters/:userId
   * Get statistics for a specific gifter
   */
  @Get('gifters/:userId')
  async getGifterStats(@Param('userId') userId: string) {
    return this.analyticsService.getGifterStats(userId);
  }

  /**
   * GET /admin/gifts/analytics/hosts/leaderboard
   * Get top earning hosts leaderboard
   */
  @Get('hosts/leaderboard')
  async getTopEarningHostsLeaderboard(@Query('limit') limit?: string) {
    return this.analyticsService.getTopEarningHostsLeaderboard(
      limit ? parseInt(limit, 10) : 100,
    );
  }

  /**
   * GET /admin/gifts/analytics/hosts/:userId
   * Get statistics for a specific host receiver
   */
  @Get('hosts/:userId')
  async getReceiverStats(@Param('userId') userId: string) {
    return this.analyticsService.getReceiverStats(userId);
  }

  /**
   * GET /admin/gifts/analytics/trends
   * Get gift popularity trends
   */
  @Get('trends')
  async getGiftPopularityTrends(@Query('limit') limit?: string) {
    return this.analyticsService.getGiftPopularityTrends(
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
