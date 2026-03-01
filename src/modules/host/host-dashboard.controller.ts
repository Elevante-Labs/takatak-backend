import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HostDashboardService } from './host-dashboard.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('host')
@UseGuards(AuthGuard('jwt'))
export class HostDashboardController {
  constructor(
    private readonly hostDashboardService: HostDashboardService,
  ) {}

  @Get('dashboard')
  async getDashboard(@CurrentUser() user: JwtPayload) {
    return this.hostDashboardService.getDashboard(user.sub);
  }
}
