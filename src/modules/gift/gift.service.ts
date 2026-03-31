import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GiftResponseDto } from './dto';

export interface SendGiftResult {
  message: {
    id: string;
    chatId: string;
    senderId: string;
    content: string;
    messageType: string;
    coinCost: number;
    diamondGenerated: number;
    createdAt: Date;
    giftId: string;
    giftName: string;
    giftIcon: string;
    giftAnimation?: string;
  };
  transaction: {
    transactionId: string;
    coinAmount: number;
    diamondAmount: number;
  };
  gift: GiftResponseDto;
  senderBalance: { totalCoins: number } | null;
  receiverBalance: { diamonds: number } | null;
  otherUserId: string;
}

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);
  private readonly GIFT_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Get all active gifts from cache or database.
   * Sorted by displayOrder.
   */
  async getCatalog(includeInactive: boolean = false): Promise<GiftResponseDto[]> {
    // Try to get from cache first
    const cacheKey = includeInactive ? 'gifts:catalog:all' : 'gifts:catalog:active';
    if (this.redis.isAvailable) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Gifts loaded from cache (${cacheKey})`);
          return JSON.parse(cached) as GiftResponseDto[];
        }
      } catch (error) {
        this.logger.warn(`Cache read failed: ${(error as Error).message}`);
      }
    }

    // Query from database
    const gifts = await this.prisma.gift.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    // Convert to response DTOs
    const dtos = gifts.map((g) => this.toResponseDto(g));

    // Cache result
    if (this.redis.isAvailable) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(dtos), this.GIFT_CACHE_TTL);
      } catch (error) {
        this.logger.warn(`Cache write failed: ${(error as Error).message}`);
      }
    }

    return dtos;
  }

  /**
   * Get a single gift by ID.
   */
  async getGiftById(giftId: string): Promise<GiftResponseDto> {
    const cacheKey = `gift:${giftId}`;

    if (this.redis.isAvailable) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as GiftResponseDto;
        }
      } catch (error) {
        this.logger.warn(`Cache read failed: ${(error as Error).message}`);
      }
    }

    const gift = await this.prisma.gift.findUnique({
      where: { id: giftId },
    });

    if (!gift) {
      throw new NotFoundException(`Gift not found: ${giftId}`);
    }

    const dto = this.toResponseDto(gift);

    if (this.redis.isAvailable) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(dto), this.GIFT_CACHE_TTL);
      } catch (error) {
        this.logger.warn(`Cache write failed: ${(error as Error).message}`);
      }
    }

    return dto;
  }

  /**
   * Invalidate cache for all gifts.
   */
  async invalidateGiftCache(giftId?: string): Promise<void> {
    if (!this.redis.isAvailable) return;

    try {
      if (giftId) {
        await this.redis.del(`gift:${giftId}`);
      }
      await this.redis.del('gifts:catalog:active');
      await this.redis.del('gifts:catalog:all');
      this.logger.debug(`Gift cache invalidated${giftId ? ` for ${giftId}` : ''}`);
    } catch (error) {
      this.logger.warn(`Cache invalidation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Send a gift in a chat. Deducts coins from sender, credits diamonds to host.
   * Atomically updates gift analytics.
   */
  async sendGift(
    senderId: string,
    chatId: string,
    giftId: string,
    idempotencyKey: string,
    userVipLevel: number = 0,
  ): Promise<SendGiftResult> {
    // 1. Validate gift exists and is available
    const gift = await this.getGiftById(giftId);
    if (!gift.isActive) {
      throw new BadRequestException('This gift is currently unavailable');
    }

    if (!gift.isCurrentlyAvailable()) {
      throw new BadRequestException('This gift is not available during this time period');
    }

    if (!gift.canSend(userVipLevel)) {
      throw new BadRequestException(
        `This gift requires VIP level ${gift.minVipLevel}`,
      );
    }

    // 2. Redis idempotency check
    if (this.redis.isAvailable) {
      const existing = await this.redis.get(
        `gift:idempotency:${idempotencyKey}`,
      );
      if (existing) {
        throw new BadRequestException('Duplicate gift send request');
      }
    }

    // 3. Validate chat & participant
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, user1Id: true, user2Id: true },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.user1Id !== senderId && chat.user2Id !== senderId) {
      throw new BadRequestException(
        'You are not a participant in this chat',
      );
    }

    const receiverId =
      chat.user1Id === senderId ? chat.user2Id : chat.user1Id;

    // 4. Process payment via wallet service
    const txResult = await this.walletService.processChatPayment({
      senderId,
      receiverId,
      coinCost: gift.coinCost,
      diamondGenerated: gift.diamondValue,
      idempotencyKey,
    });

    // 5. Create gift message
    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId,
        content: `gift:${giftId}`,
        messageType: 'GIFT',
        coinCost: gift.coinCost,
        diamondGenerated: gift.diamondValue,
      },
    });

    // 6. Record gift transaction metadata
    await this.prisma.giftTransaction.create({
      data: {
        transactionId: txResult.transactionId,
        giftId,
        senderId,
        receiverId,
        coinCost: gift.coinCost,
        diamondValue: gift.diamondValue,
        comboCount: 1,
        appliedMultiplier: 1.0,
      },
    });

    // 7. Update gift analytics (fire-and-forget)
    this.updateGiftAnalytics(giftId, gift.diamondValue, senderId, receiverId)
      .catch((err) => {
        this.logger.warn(`Failed to update gift analytics: ${err.message}`);
      });

    // 8. Cache idempotency
    if (this.redis.isAvailable) {
      await this.redis.set(
        `gift:idempotency:${idempotencyKey}`,
        message.id,
        300,
      );
    }

    // 9. Fetch updated balances
    let senderBalance: { totalCoins: number } | null = null;
    let receiverBalance: { diamonds: number } | null = null;

    try {
      const sb = await this.walletService.getBalance(senderId);
      senderBalance = { totalCoins: sb.totalCoins };
    } catch (_) {}

    try {
      const rb = await this.walletService.getBalance(receiverId);
      receiverBalance = { diamonds: rb.diamonds };
    } catch (_) {}

    this.logger.log(
      `Gift sent: ${gift.name} from ${senderId} to ${receiverId} in chat ${chatId} (tx: ${txResult.transactionId})`,
    );

    return {
      message: {
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        messageType: message.messageType,
        coinCost: message.coinCost,
        diamondGenerated: message.diamondGenerated,
        createdAt: message.createdAt,
        giftId: gift.id,
        giftName: gift.name,
        giftIcon: gift.iconUrl,
        giftAnimation: gift.animationUrl,
      },
      transaction: {
        transactionId: txResult.transactionId,
        coinAmount: txResult.coinAmount,
        diamondAmount: txResult.diamondAmount,
      },
      gift,
      senderBalance,
      receiverBalance,
      otherUserId: receiverId,
    };
  }

  /**
   * Update gift analytics: total sent count, diamonds earned, unique senders/receivers
   */
  private async updateGiftAnalytics(
    giftId: string,
    diamondValue: number,
    senderId: string,
    receiverId: string,
  ): Promise<void> {
    await this.prisma.giftAnalytics.upsert({
      where: { giftId },
      create: {
        giftId,
        totalSent: 1,
        totalDiamondsEarned: diamondValue,
        uniqueSenders: 1,
        uniqueReceivers: 1,
        lastSentAt: new Date(),
        popularityScore: 1.0,
      },
      update: {
        totalSent: { increment: 1 },
        totalDiamondsEarned: { increment: diamondValue },
        lastSentAt: new Date(),
      },
    });
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
