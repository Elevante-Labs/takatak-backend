import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReferralService } from './referral.service';
import { CreateReferralDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('referral')
@UseGuards(AuthGuard('jwt'))
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  async applyReferral(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReferralDto,
  ) {
    return this.referralService.processRegistrationReferral(
      user.sub,
      dto.referralCode,
    );
  }

  @Get('stats')
  async getReferralStats(@CurrentUser() user: JwtPayload) {
    return this.referralService.getReferralStats(user.sub);
  }

  @Get('history')
  async getReferralHistory(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationDto,
  ) {
    return this.referralService.getReferralHistory(
      user.sub,
      query.page,
      query.limit,
    );
  }
}
