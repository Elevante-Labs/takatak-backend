import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HostRewardService } from './host-reward.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('host/rewards')
@UseGuards(AuthGuard('jwt'))
export class HostRewardController {
  constructor(private readonly hostRewardService: HostRewardService) {}

  /**
   * Get current host reward status for today
   */
  @Get('status')
  async getRewardStatus(@CurrentUser() user: JwtPayload) {
    return this.hostRewardService.getHostRewardStatus(user.sub);
  }

  /**
   * Claim daily live bonus (salary tier)
   * Host must have met diamond + live hour targets
   */
  @Post('claim/daily-bonus')
  async claimDailyBonus(@CurrentUser() user: JwtPayload) {
    return this.hostRewardService.claimDailyReward(user.sub);
  }

  /**
   * Claim new female host reward (within 7 days)
   */
  @Post('claim/new-host')
  async claimNewHostReward(@CurrentUser() user: JwtPayload) {
    return this.hostRewardService.claimNewHostReward(user.sub);
  }

  /**
   * Claim ordinary female host reward (after 7 days, income < 40k)
   */
  @Post('claim/ordinary')
  async claimOrdinaryReward(@CurrentUser() user: JwtPayload) {
    return this.hostRewardService.claimOrdinaryHostReward(user.sub);
  }

  /**
   * Get reward claim history
   */
  @Get('history')
  async getRewardHistory(
    @CurrentUser() user: JwtPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.hostRewardService.getRewardHistory(user.sub, page, limit);
  }

  /**
   * Register a host as superstar (admin only)
   */
  @Post('superstar/register')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async registerSuperstar(
    @Body() body: { hostUserId: string; tag: string; month?: string },
  ) {
    const month = body.month ? new Date(body.month) : undefined;
    return this.hostRewardService.registerSuperstar(
      body.hostUserId,
      body.tag,
      month,
    );
  }

  /**
   * Process superstar salaries for a given month (admin only)
   */
  @Post('superstar/process-salaries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async processSuperstarSalaries(@Body() body: { month: string }) {
    return this.hostRewardService.processSuperstarSalaries(new Date(body.month));
  }
}
