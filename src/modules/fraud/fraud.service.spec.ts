import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

describe('FraudService', () => {
  let service: FraudService;

  const mockClient = {
    eval: jest.fn(),
  };

  const mockPrismaService = {
    fraudFlag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockClient),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'fraud.maxMessagesPerMinute': 30,
        'fraud.maxAccountsPerDevice': 2,
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FraudService>(FraudService);

    jest.clearAllMocks();
    // Re-bind getClient since clearAllMocks resets it
    mockRedisService.getClient.mockReturnValue(mockClient);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkMessageRateLimit', () => {
    it('should allow messages within rate limit', async () => {
      mockClient.eval.mockResolvedValue(5); // 5 messages, under 30 limit

      await expect(
        service.checkMessageRateLimit('user-1'),
      ).resolves.toBeUndefined(); // no throw = allowed
    });

    it('should throw when messages exceed rate limit', async () => {
      mockClient.eval.mockResolvedValue(31); // 31 messages, over 30 limit

      // flagSuspiciousActivity will be called internally
      mockPrismaService.fraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        userId: 'user-1',
        type: 'RATE_ABUSE',
        resolved: false,
      });

      await expect(
        service.checkMessageRateLimit('user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('detectSelfChat', () => {
    it('should detect self-chat by same device fingerprint', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ deviceFingerprint: 'device-abc' })
        .mockResolvedValueOnce({ deviceFingerprint: 'device-abc' });

      // flagSuspiciousActivity will be called internally
      mockPrismaService.fraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        type: 'SELF_CHAT',
      });

      const result = await service.detectSelfChat('user-1', 'user-2');

      expect(result).toBe(true);
    });

    it('should not flag different devices', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ deviceFingerprint: 'device-abc' })
        .mockResolvedValueOnce({ deviceFingerprint: 'device-xyz' });

      const result = await service.detectSelfChat('user-1', 'user-2');

      expect(result).toBe(false);
    });

    it('should handle null device fingerprints', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ deviceFingerprint: null })
        .mockResolvedValueOnce({ deviceFingerprint: null });

      const result = await service.detectSelfChat('user-1', 'user-2');

      expect(result).toBe(false);
    });
  });

  describe('checkMultiAccountByDevice', () => {
    it('should detect multiple accounts on same device', async () => {
      // Service uses user.findMany to get other accounts, then checks length >= maxAccountsPerDevice (2)
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-3' },
      ]);
      // flagSuspiciousActivity called internally
      mockPrismaService.fraudFlag.create.mockResolvedValue({});

      const result = await service.checkMultiAccountByDevice('device-abc', 'user-1');

      expect(result.flagged).toBe(true);
      expect(result.otherAccountIds).toEqual(['user-2', 'user-3']);
      expect(mockPrismaService.fraudFlag.create).toHaveBeenCalled();
    });

    it('should allow single account per device', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.checkMultiAccountByDevice('device-abc', 'user-1');

      expect(result.flagged).toBe(false);
      expect(result.otherAccountIds).toEqual([]);
      expect(mockPrismaService.fraudFlag.create).not.toHaveBeenCalled();
    });

    it('should skip check for missing device fingerprint', async () => {
      const result = await service.checkMultiAccountByDevice('', 'user-1');

      expect(result.flagged).toBe(false);
      expect(result.otherAccountIds).toEqual([]);
    });
  });

  describe('flagSuspiciousActivity', () => {
    it('should create a fraud flag record', async () => {
      const flagData = {
        type: 'RATE_ABUSE',
        description: 'User sent 50 messages in 60 seconds',
      };

      mockPrismaService.fraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        userId: 'user-1',
        type: 'RATE_ABUSE',
        resolved: false,
        createdAt: new Date(),
      });

      const result = await service.flagSuspiciousActivity(
        'user-1',
        flagData,
      );

      expect(result).toBeDefined();
      expect(mockPrismaService.fraudFlag.create).toHaveBeenCalled();
    });
  });

  describe('resolveFraudFlag', () => {
    it('should resolve an existing fraud flag', async () => {
      mockPrismaService.fraudFlag.update.mockResolvedValue({
        id: 'flag-1',
        resolved: true,
      });

      const result = await service.resolveFraudFlag('flag-1');

      expect(result.resolved).toBe(true);
      expect(mockPrismaService.fraudFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: { resolved: true },
      });
    });
  });

  describe('getUserFraudSummary', () => {
    it('should return a summary of fraud flags for a user', async () => {
      mockPrismaService.fraudFlag.groupBy.mockResolvedValue([
        { type: 'RATE_ABUSE', _count: 3 },
        { type: 'SELF_CHAT', _count: 2 },
      ]);
      mockPrismaService.fraudFlag.count.mockResolvedValue(5);

      const result = await service.getUserFraudSummary('user-1');

      expect(result).toBeDefined();
      expect(result.totalFlags).toBe(5);
      expect(result.flagsByType).toEqual({
        RATE_ABUSE: 3,
        SELF_CHAT: 2,
      });
      expect(mockPrismaService.fraudFlag.groupBy).toHaveBeenCalled();
      expect(mockPrismaService.fraudFlag.count).toHaveBeenCalled();
    });
  });
});
