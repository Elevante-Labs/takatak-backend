import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { FraudService } from '../fraud/fraud.service';
import { VipService } from '../vip/vip.service';
import { IntimacyService } from './intimacy.service';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';

type MessageType = 'TEXT' | 'IMAGE' | 'EMOJI';

/**
 * Referral abuse window: diamonds generated from chats between
 * referral pairs within this period after referral creation are
 * credited as promoDiamonds (non-withdrawable) instead of real diamonds.
 */
const REFERRAL_ABUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Default max message length if SystemSettings not configured */
const DEFAULT_MAX_MESSAGE_LENGTH = 300;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly walletService: WalletService,
    private readonly fraudService: FraudService,
    private readonly vipService: VipService,
    private readonly configService: ConfigService,
    private readonly intimacyService: IntimacyService,
  ) { }

  // ──────────────────────────────────────────
  // Diamond earning rules (Phase 1)
  // ──────────────────────────────────────────
  //
  // | Sender → Receiver | Coins Charged | Diamonds Generated |
  // |--------------------|---------------|--------------------|
  // | USER → HOST        | Yes (VIP disc)| Yes → to HOST      |
  // | USER → USER        | Yes (VIP disc)| NO                 |
  // | HOST → anyone      | FREE          | NO                 |
  //
  // Mutual-follow-free: If USER and HOST mutually follow each other,
  // chat is free (no coins, no diamonds). One-way follow is NOT enough.
  // ──────────────────────────────────────────

  /**
   * Create or retrieve existing 1:1 chat room.
   * Phase 1: Allows USER→HOST and USER→USER chats.
   */
  async createOrGetChat(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Cannot create chat with yourself');
    }

    // Verify target exists and is active
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });

    if (!target || !target.isActive || target.deletedAt) {
      throw new NotFoundException('User not found or inactive');
    }

    // Ensure consistent ordering for unique constraint
    const [user1Id, user2Id] =
      userId < targetId ? [userId, targetId] : [targetId, userId];

    let chat = await this.prisma.chat.findUnique({
      where: {
        user1Id_user2Id: { user1Id, user2Id },
      },
    });

    if (!chat) {
      chat = await this.prisma.chat.create({
        data: { user1Id, user2Id },
      });
      this.logger.log(`Chat created between ${userId} and ${targetId}`);
    }

    return chat;
  }

  /**
   * Check if two users mutually follow each other.
   * Uses a single indexed COUNT query (both directions) — returns true only when count === 2.
   */
  private async isMutualFollow(
    userA: string,
    userB: string,
  ): Promise<boolean> {
    const count = await this.prisma.follow.count({
      where: {
        OR: [
          { followerId: userA, followeeId: userB },
          { followerId: userB, followeeId: userA },
        ],
      },
    });
    return count === 2;
  }

  /**
   * Get max message length from SystemSettings or default.
   */
  private async getMaxMessageLength(): Promise<number> {
    const setting = await this.prisma.systemSettings.findUnique({
      where: { key: 'MESSAGE_MAX_LENGTH' },
    });
    return setting ? parseInt(setting.value, 10) : DEFAULT_MAX_MESSAGE_LENGTH;
  }

  /**
   * Sanitize message content: trim, collapse whitespace, strip control chars.
   */
  private sanitizeContent(content: string): string {
    return content
      .trim()
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
      .replace(/\s+/g, ' '); // collapse whitespace
  }

  /**
   * Send a message in a chat — the core monetized flow.
   *
   * Phase 1 business rules:
   * 1. Message length enforced (configurable via SystemSettings)
   * 2. HOST → anyone = FREE, no diamonds
   * 3. USER → USER = charged, NO diamonds generated
   * 4. USER → HOST = charged, diamonds generated for HOST
   * 5. Mutual-follow-free: USER and HOST mutually follow each other = free, no diamonds
   * 6. Referral pair detection routes diamonds to promoDiamonds
   */
  async sendMessage(
    senderId: string,
    chatId: string,
    content: string,
    idempotencyKey?: string,
    messageType: MessageType = 'TEXT',
    mediaUrl?: string,
  ) {
    // ── early idempotency lookup ──
    if (idempotencyKey) {
      const cacheKey = `chat-msg:${senderId}:${chatId}:${idempotencyKey}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        // already processed; return parsed result so caller can behave identically
        return JSON.parse(cached);
      }
    }

    // ── 1. Content validation & sanitization ──
    let sanitized = content;
    if (messageType === 'IMAGE') {
      if (!mediaUrl) throw new BadRequestException('Image URL is required for image messages');
      sanitized = content || '📷 Image';
    } else {
      sanitized = this.sanitizeContent(content);
      const maxLength = await this.getMaxMessageLength();
      if (!sanitized || sanitized.length === 0) {
        throw new BadRequestException('Message content cannot be empty');
      }
      if (sanitized.length > maxLength) {
        throw new BadRequestException(
          `Message exceeds maximum length of ${maxLength} characters`,
        );
      }
    }

    // ── 2. Validate chat and participants ──
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        user1: {
          select: {
            id: true,
            role: true,
            vipLevel: true,
            deviceFingerprint: true,
          },
        },
        user2: {
          select: {
            id: true,
            role: true,
            vipLevel: true,
            deviceFingerprint: true,
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.user1Id !== senderId && chat.user2Id !== senderId) {
      throw new ForbiddenException('You are not a participant of this chat');
    }

    const sender = chat.user1Id === senderId ? chat.user1 : chat.user2;
    const receiver = chat.user1Id === senderId ? chat.user2 : chat.user1;

    // ── 3. Fraud: self-chat detection ──
    if (
      sender.deviceFingerprint &&
      receiver.deviceFingerprint &&
      sender.deviceFingerprint === receiver.deviceFingerprint
    ) {
      await this.fraudService.flagSuspiciousActivity(senderId, {
        type: 'SELF_CHAT',
        description:
          'Same device fingerprint detected on both chat participants',
        chatId,
        deviceFingerprint: sender.deviceFingerprint,
      });
      throw new BadRequestException('Suspicious activity detected');
    }

    // ── 4. Rate limit ──
    await this.fraudService.checkMessageRateLimit(senderId);

    // ── 5. Determine charging & diamond rules ──
    const senderIsHost = sender.role === 'HOST';
    const receiverIsHost = receiver.role === 'HOST';

    // HOST → anyone = free, no charge, no diamonds
    if (senderIsHost) {
      return this.persistAndPublish(chatId, senderId, sanitized, 0, 0, null, idempotencyKey, receiver.id, messageType, mediaUrl);
    }

    // USER → HOST: check if mutual-follow-makes-free
    if (receiverIsHost) {
      const mutual = await this.isMutualFollow(sender.id, receiver.id);
      if (mutual) {
        this.logger.log(
          `Mutual-follow-free: ${sender.id} <-> HOST ${receiver.id}, message is free`,
        );
        // Still update intimacy even for free messages
        await this.intimacyService.onMessageSent(sender.id, receiver.id).catch(() => {});
        return this.persistAndPublish(chatId, senderId, sanitized, 0, 0, null, idempotencyKey, receiver.id, messageType, mediaUrl);
      }
    }

    // USER sending → charged message
    const baseCoinCost =
      this.configService.get<number>('wallet.messageCoinCost') || 10;
    const coinCost = this.vipService.calculateDiscountedCost(
      baseCoinCost,
      sender.vipLevel,
    );

    // Diamonds ONLY generated for USER → HOST
    const generateDiamonds = receiverIsHost;
    const ratio =
      this.configService.get<number>('wallet.coinToDiamondRatio') || 1;
    const diamondGenerated = generateDiamonds
      ? Math.floor(coinCost * ratio)
      : 0;

    // ── 6. Referral abuse check (only when diamonds are generated) ──
    let usePromoDiamonds = false;

    if (diamondGenerated > 0) {
      const referralLink = await this.prisma.referral.findFirst({
        where: {
          OR: [
            { referrerId: sender.id, referredId: receiver.id },
            { referrerId: receiver.id, referredId: sender.id },
          ],
          createdAt: {
            gt: new Date(Date.now() - REFERRAL_ABUSE_WINDOW_MS),
          },
        },
      });

      if (referralLink) {
        usePromoDiamonds = true;
        this.logger.warn(
          `Referral pair chat detected: ${sender.id} <-> ${receiver.id}. Diamonds credited as promo.`,
        );
      }
    }

    // ── 7. Process payment atomically ──
    // use the passed idempotency key if available; prefix to avoid collisions
    const paymentIdempotencyKey = idempotencyKey
      ? `chat-pay:${senderId}:${chatId}:${idempotencyKey}`
      : `chat-pay:${senderId}:${chatId}:${Date.now()}`;

    const transactionResult = await this.walletService.processChatPayment({
      senderId: sender.id,
      receiverId: receiver.id,
      coinCost,
      diamondGenerated,
      usePromoDiamonds,
      idempotencyKey: paymentIdempotencyKey,
    });

    // Update intimacy for USER → HOST messages
    let intimacyUpdate = null;
    if (receiverIsHost) {
      intimacyUpdate = await this.intimacyService.onMessageSent(sender.id, receiver.id).catch(() => null);
    }

    const result = await this.persistAndPublish(
      chatId,
      senderId,
      sanitized,
      coinCost,
      diamondGenerated,
      transactionResult,
      idempotencyKey,
      receiver.id,
      messageType,
      mediaUrl,
    );

    if (intimacyUpdate) {
      result.intimacy = {
        level: intimacyUpdate.level,
        points: intimacyUpdate.points,
      };
    }

    return result;
  }

  /**
   * Persist message, publish to Redis, return payload.
   * Shared by all send paths (free / charged).
   */
  private async persistAndPublish(
    chatId: string,
    senderId: string,
    content: string,
    coinCost: number,
    diamondGenerated: number,
    transactionResult: any,
    idempotencyKey?: string,
    otherUserId?: string,
    messageType: MessageType = 'TEXT',
    mediaUrl?: string,
  ) {
    // Dedup guard for very quick repeats (same ms)
    const dedupKey = `msg:${senderId}:${chatId}:${Date.now()}`;
    const isDuplicate = await this.redis.get(dedupKey);
    if (isDuplicate) {
      throw new BadRequestException('Duplicate message detected');
    }
    await this.redis.set(dedupKey, '1', 5);

    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId,
        content,
        messageType,
        mediaUrl: mediaUrl || null,
        coinCost,
        diamondGenerated,
      },
    });

    const messagePayload = {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      messageType: message.messageType,
      mediaUrl: message.mediaUrl,
      coinCost: message.coinCost,
      diamondGenerated: message.diamondGenerated,
      createdAt: message.createdAt.toISOString(),
    };

    const result: any = {
      message: messagePayload,
      transaction: transactionResult,
      otherUserId, // Passed through so gateway can notify the recipient
    };

    // if an idempotency key was provided, cache the final result so that
    // repeated requests return the same payload and avoid double-processing
    if (idempotencyKey) {
      const cacheKey = `chat-msg:${senderId}:${chatId}:${idempotencyKey}`;
      // keep for 1 day (arbitrary); adjust to business needs
      await this.redis.set(cacheKey, JSON.stringify(result), 86400);
    }

    // NOTE: No Redis publish here. The gateway uses @socket.io/redis-adapter
    // which automatically broadcasts server.to().emit() across instances.

    this.logger.log(
      `Message sent in chat ${chatId} by ${senderId}` +
      (coinCost > 0 ? ` (cost: ${coinCost} coins)` : ' (free)'),
    );

    return result;
  }


  /**
   * Get chat messages with pagination.
   */
  async getChatMessages(
    userId: string,
    chatId: string,
    page?: number,
    limit?: number,
  ) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.user1Id !== userId && chat.user2Id !== userId) {
      throw new ForbiddenException('You are not a participant of this chat');
    }

    const params = getPaginationParams(page, limit);

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { chatId },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          chatId: true,
          senderId: true,
          content: true,          messageType: true,
          mediaUrl: true,          coinCost: true,
          createdAt: true,
        },
      }),
      this.prisma.message.count({ where: { chatId } }),
    ]);

    return buildPaginatedResult(messages, total, params);
  }

  /**
   * Get user's chat list.
   */
  async getUserChats(userId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = {
      OR: [{ user1Id: userId }, { user2Id: userId }],
      isActive: true,
    };

    const [chats, total] = await Promise.all([
      this.prisma.chat.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          user1: {
            select: {
              id: true,
              username: true,
              phone: true,
              role: true,
              vipLevel: true,
            },
          },
          user2: {
            select: {
              id: true,
              username: true,
              phone: true,
              role: true,
              vipLevel: true,
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { content: true, createdAt: true, senderId: true },
          },
        },
      }),
      this.prisma.chat.count({ where }),
    ]);

    return buildPaginatedResult(chats, total, params);
  }

  /**
   * Track active session in Redis.
   */
  async trackSession(userId: string, chatId: string, socketId: string) {
    await this.redis.set(
      `session:${userId}:${chatId}`,
      socketId,
      3600, // 1 hour TTL
    );

    await this.prisma.chatSession.create({
      data: { userId, chatId, socketId },
    });
  }

  /**
   * Remove session tracking.
   */
  async removeSession(userId: string, chatId: string) {
    await this.redis.del(`session:${userId}:${chatId}`);

    await this.prisma.chatSession.updateMany({
      where: { userId, chatId, isActive: true },
      data: { isActive: false, leftAt: new Date() },
    });
  }

  /**
   * Get intimacy info for a chat between userId and hostId.
   */
  async getIntimacyInfo(userId: string, hostId: string) {
    return this.intimacyService.getIntimacyInfo(userId, hostId);
  }
}
