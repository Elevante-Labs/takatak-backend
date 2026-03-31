import { Controller, Get, UseGuards, Query, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GiftService } from './gift.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('gifts')
@UseGuards(AuthGuard('jwt'))
export class GiftController {
  constructor(private readonly giftService: GiftService) {}

  /**
   * GET /gifts
   * Returns all active gifts (database-driven, cached)
   */
  @Get()
  async getCatalog() {
    return this.giftService.getCatalog(false);
  }

  /**
   * GET /gifts/:id
   * Returns a single gift by ID
   */
  @Get(':id')
  async getGift(@Param('id') giftId: string) {
    return this.giftService.getGiftById(giftId);
  }
}
