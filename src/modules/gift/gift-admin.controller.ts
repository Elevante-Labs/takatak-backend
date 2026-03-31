import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GiftAdminService } from './gift-admin.service';
import { CreateGiftDto, UpdateGiftDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('admin/gifts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN' as any)
export class GiftAdminController {
  private readonly logger = new Logger(GiftAdminController.name);

  constructor(private readonly giftAdminService: GiftAdminService) {}

  /**
   * POST /admin/gifts
   * Create a new gift
   */
  @Post()
  async createGift(
    @Body() dto: CreateGiftDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    this.logger.log(
      `Admin ${admin.sub} creating gift: ${dto.name}`,
    );
    return this.giftAdminService.createGift(dto);
  }

  /**
   * GET /admin/gifts
   * List all gifts with filtering and pagination
   */
  @Get()
  async listGifts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('rarity') rarity?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.giftAdminService.listGifts({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      category,
      rarity,
      isActive: isActive ? isActive === 'true' : undefined,
    });
  }

  /**
   * GET /admin/gifts/analytics/top
   * Get top gifts by sends
   */
  @Get('analytics/top')
  async getTopGifts(@Query('limit') limit?: string) {
    return this.giftAdminService.getTopGifts(
      limit ? parseInt(limit, 10) : 10,
    );
  }

  /**
   * GET /admin/gifts/:id
   * Get a single gift with analytics
   */
  @Get(':id')
  async getGift(@Param('id') giftId: string) {
    return this.giftAdminService.getGiftAnalytics(giftId);
  }

  /**
   * PATCH /admin/gifts/:id
   * Update a gift
   */
  @Patch(':id')
  async updateGift(
    @Param('id') giftId: string,
    @Body() dto: UpdateGiftDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    this.logger.log(`Admin ${admin.sub} updating gift: ${giftId}`);
    return this.giftAdminService.updateGift(giftId, dto);
  }

  /**
   * DELETE /admin/gifts/:id
   * Soft delete a gift (mark as inactive)
   */
  @Delete(':id')
  async deleteGift(
    @Param('id') giftId: string,
    @CurrentUser() admin: JwtPayload,
  ) {
    this.logger.log(`Admin ${admin.sub} deleting gift: ${giftId}`);
    await this.giftAdminService.deleteGift(giftId);
    return { success: true, message: 'Gift deleted successfully' };
  }

  /**
   * PATCH /admin/gifts/bulk/update
   * Bulk update gifts (e.g., toggle event gifts)
   * Body: { filter: {...}, update: {...} }
   */
  @Patch('bulk/update')
  async bulkUpdateGifts(
    @Body() body: { filter: Record<string, any>; update: Record<string, any> },
    @CurrentUser() admin: JwtPayload,
  ) {
    this.logger.log(
      `Admin ${admin.sub} bulk updating gifts with filter: ${JSON.stringify(body.filter)}`,
    );
    const count = await this.giftAdminService.bulkUpdateGifts(
      body.filter,
      body.update,
    );
    return { success: true, updatedCount: count };
  }
}
