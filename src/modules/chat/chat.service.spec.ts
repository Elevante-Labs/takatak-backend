import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { FraudService } from '../fraud/fraud.service';
import { VipService } from '../vip/vip.service';

describe('ChatService', () => {
  let service: ChatService;

  const mockPrismaService = {
    chat: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    chatSession: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    referral: {
      findFirst: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    publish: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockWalletService = {
    processChatPayment: jest.fn(),
    getBalance: jest.fn(),
  };

  const mockFraudService = {
    checkMessageRateLimit: jest.fn(),
    detectSelfChat: jest.fn(),
    flagSuspiciousActivity: jest.fn(),
  };

  const mockVipService = {
    calculateDiscountedCost: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'wallet.messageCoinCost': 10,
        'wallet.coinToDiamondRatio': 1,
      };
      return config[key];
    }),
  };

  // Helper to build a chat mock with user1/user2 includes
  function buildChatMock(
    chatId: string,
    u1: { id: string; role: string; vipLevel?: number; deviceFingerprint?: string | null },
    u2: { id: string; role: string; vipLevel?: number; deviceFingerprint?: string | null },
  ) {
    return {
      id: chatId,
      user1Id: u1.id,
      user2Id: u2.id,
      isActive: true,
      user1: {
        id: u1.id,
        role: u1.role,
        vipLevel: u1.vipLevel ?? 0,
        deviceFingerprint: u1.deviceFingerprint ?? null,
      },
      user2: {
        id: u2.id,
        role: u2.role,
        vipLevel: u2.vipLevel ?? 0,
        deviceFingerprint: u2.deviceFingerprint ?? null,
      },
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: FraudService, useValue: mockFraudService },
        { provide: VipService, useValue: mockVipService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);

    jest.clearAllMocks();
    // Default: no rate limit (resolves without throwing), no dedup
    mockFraudService.checkMessageRateLimit.mockResolvedValue(undefined);
    mockRedisService.get.mockResolvedValue(null);
    mockPrismaService.systemSettings.findUnique.mockResolvedValue(null);
    mockPrismaService.referral.findFirst.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should reject message exceeding max length', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        key: 'MESSAGE_MAX_LENGTH',
        value: '10',
      });

      await expect(
        service.sendMessage('user-1', 'chat-1', 'A'.repeat(20)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject empty message', async () => {
      await expect(
        service.sendMessage('user-1', 'chat-1', '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('should block self-chat (same device fingerprint)', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER', deviceFingerprint: 'device-abc' },
        { id: 'user-2', role: 'HOST', deviceFingerprint: 'device-abc' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      await expect(
        service.sendMessage('user-1', 'chat-1', 'Hello'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should block rate-limited users', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);
      mockFraudService.checkMessageRateLimit.mockRejectedValue(
        new BadRequestException('Message rate limit exceeded. Slow down.'),
      );

      await expect(
        service.sendMessage('user-1', 'chat-1', 'Hello'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow hosts to reply for free (no coin deduction)', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-1',
        chatId: 'chat-1',
        senderId: 'host-1',
        content: 'Hey there!',
        coinCost: 0,
        diamondGenerated: 0,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('host-1', 'chat-1', 'Hey there!');

      expect(mockWalletService.processChatPayment).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should charge USER for sending message to HOST with diamond generation', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      mockPrismaService.follow.count.mockResolvedValue(0); // no follow relationship
      mockVipService.calculateDiscountedCost.mockReturnValue(8);

      mockWalletService.processChatPayment.mockResolvedValue({
        transactionId: 'tx-1',
        status: 'COMPLETED',
        coinAmount: 8,
        diamondAmount: 8,
      });

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-2',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'Hello host!',
        coinCost: 8,
        diamondGenerated: 8,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'Hello host!');

      expect(mockWalletService.processChatPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: 'user-1',
          receiverId: 'host-1',
          coinCost: 8,
        }),
      );
      expect(result.transaction).toBeDefined();
    });

    it('should allow free chat when USER and HOST mutually follow each other', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      // Mutual follow: count of both directions = 2
      mockPrismaService.follow.count.mockResolvedValue(2);

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-3',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'Hey!',
        coinCost: 0,
        diamondGenerated: 0,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'Hey!');

      expect(mockWalletService.processChatPayment).not.toHaveBeenCalled();
      expect(result.message.coinCost).toBe(0);
      expect(result.message.diamondGenerated).toBe(0);
    });

    it('should charge when USER follows HOST but HOST does not follow back (one-way)', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      // Only one direction → count = 1
      mockPrismaService.follow.count.mockResolvedValue(1);
      mockVipService.calculateDiscountedCost.mockReturnValue(10);

      mockWalletService.processChatPayment.mockResolvedValue({
        transactionId: 'tx-oneway-1',
        status: 'COMPLETED',
        coinAmount: 10,
        diamondAmount: 10,
      });

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-oneway-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'One way follow',
        coinCost: 10,
        diamondGenerated: 10,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'One way follow');

      expect(mockWalletService.processChatPayment).toHaveBeenCalled();
      expect(result.message.coinCost).toBe(10);
    });

    it('should charge when HOST follows USER but USER does not follow back (one-way)', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      // Only one direction → count = 1
      mockPrismaService.follow.count.mockResolvedValue(1);
      mockVipService.calculateDiscountedCost.mockReturnValue(10);

      mockWalletService.processChatPayment.mockResolvedValue({
        transactionId: 'tx-oneway-2',
        status: 'COMPLETED',
        coinAmount: 10,
        diamondAmount: 10,
      });

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-oneway-2',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'Host follows me only',
        coinCost: 10,
        diamondGenerated: 10,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'Host follows me only');

      expect(mockWalletService.processChatPayment).toHaveBeenCalled();
      expect(result.message.coinCost).toBe(10);
    });

    it('should not generate diamonds on mutual-follow free chat', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      mockPrismaService.follow.count.mockResolvedValue(2);

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-mutual-nodiamond',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'No diamonds here',
        coinCost: 0,
        diamondGenerated: 0,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'No diamonds here');

      expect(result.message.diamondGenerated).toBe(0);
      expect(mockWalletService.processChatPayment).not.toHaveBeenCalled();
    });

    it('should not deduct coins on mutual-follow free chat', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'host-1', role: 'HOST' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      mockPrismaService.follow.count.mockResolvedValue(2);

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-mutual-nocoins',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'No coins deducted',
        coinCost: 0,
        diamondGenerated: 0,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'No coins deducted');

      expect(result.message.coinCost).toBe(0);
      expect(mockWalletService.processChatPayment).not.toHaveBeenCalled();
    });

    it('should still enforce fraud checks even on mutual-follow free chat', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER', deviceFingerprint: 'same-device' },
        { id: 'host-1', role: 'HOST', deviceFingerprint: 'same-device' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      // Mutual follow exists, but same fingerprint should still block
      mockPrismaService.follow.count.mockResolvedValue(2);

      await expect(
        service.sendMessage('user-1', 'chat-1', 'Fraud attempt'),
      ).rejects.toThrow(BadRequestException);

      expect(mockWalletService.processChatPayment).not.toHaveBeenCalled();
    });

    it('should charge USER→USER (no diamonds generated)', async () => {
      const chat = buildChatMock(
        'chat-1',
        { id: 'user-1', role: 'USER' },
        { id: 'user-2', role: 'USER' },
      );
      mockPrismaService.chat.findUnique.mockResolvedValue(chat);

      mockVipService.calculateDiscountedCost.mockReturnValue(10);

      mockWalletService.processChatPayment.mockResolvedValue({
        transactionId: 'tx-2',
        status: 'COMPLETED',
        coinAmount: 10,
        diamondAmount: 0,
      });

      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-4',
        chatId: 'chat-1',
        senderId: 'user-1',
        content: 'Hello fellow user!',
        coinCost: 10,
        diamondGenerated: 0,
        createdAt: new Date(),
      });

      const result = await service.sendMessage('user-1', 'chat-1', 'Hello fellow user!');

      // Charged but no diamonds
      expect(mockWalletService.processChatPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          diamondGenerated: 0,
        }),
      );
    });

    it('should reject messages to non-existent chats', async () => {
      mockPrismaService.chat.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'nonexistent-chat', 'Hello'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createOrGetChat', () => {
    it('should return existing chat if one exists', async () => {
      const existingChat = {
        id: 'chat-1',
        user1Id: 'host-1',
        user2Id: 'user-1',
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'host-1',
        role: 'HOST',
        isActive: true,
        deletedAt: null,
      });
      mockPrismaService.chat.findUnique.mockResolvedValue(existingChat);

      const result = await service.createOrGetChat('user-1', 'host-1');

      expect(result).toEqual(existingChat);
      expect(mockPrismaService.chat.create).not.toHaveBeenCalled();
    });

    it('should create new chat if none exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'host-1',
        role: 'HOST',
        isActive: true,
        deletedAt: null,
      });
      mockPrismaService.chat.findUnique.mockResolvedValue(null);

      const newChat = {
        id: 'chat-new',
        user1Id: 'host-1',
        user2Id: 'user-1',
      };

      mockPrismaService.chat.create.mockResolvedValue(newChat);

      const result = await service.createOrGetChat('user-1', 'host-1');

      expect(result).toEqual(newChat);
      expect(mockPrismaService.chat.create).toHaveBeenCalled();
    });

    it('should reject creating chat with self', async () => {
      await expect(
        service.createOrGetChat('user-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserChats', () => {
    it('should return paginated chats for a user', async () => {
      const mockChats = [
        { id: 'chat-1' },
        { id: 'chat-2' },
      ];

      mockPrismaService.chat.findMany.mockResolvedValue(mockChats);
      mockPrismaService.chat.count.mockResolvedValue(2);

      const result = await service.getUserChats('user-1');

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('getChatMessages', () => {
    it('should return paginated messages', async () => {
      // getChatMessages signature: (userId, chatId, page, limit)
      mockPrismaService.chat.findUnique.mockResolvedValue({
        id: 'chat-1',
        user1Id: 'user-1',
        user2Id: 'host-1',
      });

      mockPrismaService.message.findMany.mockResolvedValue([
        { id: 'msg-1', content: 'Hello', createdAt: new Date() },
      ]);
      mockPrismaService.message.count.mockResolvedValue(1);

      const result = await service.getChatMessages('user-1', 'chat-1', 1, 20);

      expect(result.data).toHaveLength(1);
    });

    it('should prevent unauthorized access to chat messages', async () => {
      mockPrismaService.chat.findUnique.mockResolvedValue({
        id: 'chat-1',
        user1Id: 'user-1',
        user2Id: 'host-1',
      });

      // user-3 is not a participant
      await expect(
        service.getChatMessages('user-3', 'chat-1', 1, 20),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
