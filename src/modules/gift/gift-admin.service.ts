import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { GiftService } from './gift.service';
import { CreateGiftDto, UpdateGiftDto, GiftResponseDto } from './dto';

export interface GiftListOptions {
  page?: number;
  limit?: number;
  category?: string;
  rarity?: string;
  isActive?: boolean;
}

@Injectable()
export class GiftAdminService {
  private readonly logger = new Logger(GiftAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly giftService: GiftService,
  ) {}

  /**
   * Create a new gift
   */
  async createGift(dto: CreateGiftDto): Promise<GiftResponseDto> {
    // Validate name is unique
    const existing = await this.prisma.gift.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException(`Gift with name "${dto.name}" already exists`);
    }

    // Validate availability dates
    if (dto.isLimited && dto.availableFrom && dto.availableTill) {
      const from = new Date(dto.availableFrom);
      const till = new Date(dto.availableTill);
      if (from >= till) {
        throw new BadRequestException(
          'availableTill must be after availableFrom',
        );
      }
    }

    // Create gift with analytics
    const gift = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gift.create({
        data: {
          name: dto.name,
          description: dto.description,
          iconUrl: dto.iconUrl,
          animationUrl: dto.animationUrl,
          animationUrl_full: dto.animationUrl_full,
          coinCost: dto.coinCost,
          diamondValue: dto.diamondValue,
          category: dto.category,
          rarity: dto.rarity,
          displayOrder: dto.displayOrder ?? 0,
          isActive: dto.isActive ?? true,
          isLimited: dto.isLimited ?? false,
          availableFrom: dto.availableFrom
            ? new Date(dto.availableFrom)
            : null,
          availableTill: dto.availableTill
            ? new Date(dto.availableTill)
            : null,
          minVipLevel: dto.minVipLevel ?? 0,
          comboMultiplier: dto.comboMultiplier ?? 1.0,
          eventTag: dto.eventTag,
          metadata: dto.metadata,
        },
      });

      // Create analytics record
      await tx.giftAnalytics.create({
        data: {
          giftId: created.id,
          totalSent: 0,
          totalDiamondsEarned: 0,
          uniqueSenders: 0,
          uniqueReceivers: 0,
          popularityScore: 0.0,
        },
      });

      return created;
    });

    // Invalidate cache
    await this.giftService.invalidateGiftCache();

    this.logger.log(
      `Gift created: ${gift.name} (${gift.id}) by admin`,
    );

    return this.toResponseDto(gift);
  }

  /**
   * Update an existing gift
   */
  async updateGift(giftId: string, dto: UpdateGiftDto): Promise<GiftResponseDto> {
    // Verify gift exists
    const existing = await this.prisma.gift.findUnique({
      where: { id: giftId },
    });

    if (!existing) {
      throw new NotFoundException(`Gift not found: ${giftId}`);
    }

    // If updating name, check uniqueness
    if (dto.name && dto.name !== existing.name) {
      const conflict = await this.prisma.gift.findUnique({
        where: { name: dto.name },
      });
      if (conflict) {
        throw new ConflictException(
          `Gift with name "${dto.name}" already exists`,
        );
      }
    }

    // Validate availability dates
    const availableFrom = dto.availableFrom
      ? new Date(dto.availableFrom)
      : existing.availableFrom;
    const availableTill = dto.availableTill
      ? new Date(dto.availableTill)
      : existing.availableTill;

    if (availableFrom && availableTill && availableFrom >= availableTill) {
      throw new BadRequestException(
        'availableTill must be after availableFrom',
      );
    }

    const updated = await this.prisma.gift.update({
      where: { id: giftId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.iconUrl && { iconUrl: dto.iconUrl }),
        ...(dto.animationUrl !== undefined && {
          animationUrl: dto.animationUrl,
        }),
        ...(dto.animationUrl_full !== undefined && {
          animationUrl_full: dto.animationUrl_full,
        }),
        ...(dto.coinCost && { coinCost: dto.coinCost }),
        ...(dto.diamondValue && { diamondValue: dto.diamondValue }),
        ...(dto.category && { category: dto.category }),
        ...(dto.rarity && { rarity: dto.rarity }),
        ...(dto.displayOrder !== undefined && {
          displayOrder: dto.displayOrder,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isLimited !== undefined && { isLimited: dto.isLimited }),
        ...(availableFrom && { availableFrom }),
        ...(availableTill && { availableTill }),
        ...(dto.minVipLevel !== undefined && { minVipLevel: dto.minVipLevel }),
        ...(dto.comboMultiplier !== undefined && {
          comboMultiplier: dto.comboMultiplier,
        }),
        ...(dto.eventTag !== undefined && { eventTag: dto.eventTag }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
    });

    // Invalidate cache
    await this.giftService.invalidateGiftCache(giftId);

    this.logger.log(`Gift updated: ${updated.name} (${giftId}) by admin`);

    return this.toResponseDto(updated);
  }

  /**
   * Soft delete a gift (mark as inactive)
   */
  async deleteGift(giftId: string): Promise<void> {
    const existing = await this.prisma.gift.findUnique({
      where: { id: giftId },
    });

    if (!existing) {
      throw new NotFoundException(`Gift not found: ${giftId}`);
    }

    await this.prisma.gift.update({
      where: { id: giftId },
      data: { isActive: false },
    });

    // Invalidate cache
    await this.giftService.invalidateGiftCache(giftId);

    this.logger.log(`Gift deleted: ${existing.name} (${giftId}) by admin`);
  }

  /**
   * List gifts with filtering and pagination
   */
  async listGifts(options: GiftListOptions): Promise<{
    gifts: GiftResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options.category) where.category = options.category;
    if (options.rarity) where.rarity = options.rarity;
    if (options.isActive !== undefined) where.isActive = options.isActive;

    const [gifts, total] = await Promise.all([
      this.prisma.gift.findMany({
        where,
        skip,
        take: limit,
        orderBy: { displayOrder: 'asc' },
      }),
      this.prisma.gift.count({ where }),
    ]);

    return {
      gifts: gifts.map((g) => this.toResponseDto(g)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get gift analytics
   */
  async getGiftAnalytics(giftId: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { id: giftId },
      include: { analytics: true },
    });

    if (!gift) {
      throw new NotFoundException(`Gift not found: ${giftId}`);
    }

    return {
      gift: this.toResponseDto(gift),
      analytics: gift.analytics,
    };
  }

  /**
   * Bulk update gifts (e.g., toggle all event gifts as inactive)
   */
  async bulkUpdateGifts(
    filter: Record<string, any>,
    update: Record<string, any>,
  ): Promise<number> {
    const result = await this.prisma.gift.updateMany({
      where: filter,
      data: update,
    });

    // Invalidate cache
    await this.giftService.invalidateGiftCache();

    this.logger.log(`Bulk updated ${result.count} gifts`);

    return result.count;
  }

  /**
   * Get top gifts by sends
   */
  async getTopGifts(limit: number = 10) {
    const topGifts = await this.prisma.giftAnalytics.findMany({
      where: { totalSent: { gt: 0 } },
      orderBy: { totalSent: 'desc' },
      take: limit,
      include: { gift: true },
    });

    return topGifts.map((a) => ({
      gift: this.toResponseDto(a.gift),
      analytics: a,
    }));
  }

  /**
   * Convert Prisma Gift to ResponseDto
   */
  private toResponseDto(gift: any): GiftResponseDto {
    const dto = new GiftResponseDto();
    dto.id = gift.id;
    dto.name = gift.name;
    dto.description = gift.description;
    dto.iconUrl = gift.iconUrl;
    dto.animationUrl = gift.animationUrl;
    dto.animationUrl_full = gift.animationUrl_full;
    dto.coinCost = gift.coinCost;
    dto.diamondValue = gift.diamondValue;
    dto.category = gift.category;
    dto.rarity = gift.rarity;
    dto.displayOrder = gift.displayOrder;
    dto.isActive = gift.isActive;
    dto.isLimited = gift.isLimited;
    dto.availableFrom = gift.availableFrom;
    dto.availableTill = gift.availableTill;
    dto.minVipLevel = gift.minVipLevel;
    dto.comboMultiplier = gift.comboMultiplier;
    dto.eventTag = gift.eventTag;
    dto.metadata = gift.metadata;
    dto.createdAt = gift.createdAt;
    return dto;
  }
}
