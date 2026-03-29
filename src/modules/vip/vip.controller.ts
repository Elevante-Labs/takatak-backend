import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { VipService } from './vip.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('vip')
@UseGuards(AuthGuard('jwt'))
export class VipController {
  constructor(private readonly vipService: VipService) {}

  @Get('status')
  async getVipStatus(@CurrentUser() user: JwtPayload) {
    return this.vipService.getVipStatus(user.sub);
  }
}
