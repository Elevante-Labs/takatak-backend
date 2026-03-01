import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ReferralService } from './referral.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

describe('ReferralService', () => {
  let service: ReferralService;

  const mockPrismaService = {
    referral: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockWalletService = {
    awardReferralBonus: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'referral.rewardCoins': 50,
        'referral.firstChatReward': 25,
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ReferralService>(ReferralService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processRegistrationReferral', () => {
    it('should reject self-referral', async () => {
      // Service calls user.findFirst to find referrer by id or phone
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-1',
        phone: '+1234567890',
        deviceFingerprint: 'device-abc',
      });

      await expect(
        service.processRegistrationReferral('user-1', 'user-1', 'device-abc'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid referral code', async () => {
      // No referrer found
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.processRegistrationReferral('user-1', 'INVALID_CODE', 'device-abc'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject same device fingerprint (abuse)', async () => {
      // Referrer found with SAME device fingerprint as input
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-1',
        deviceFingerprint: 'device-abused',
      });

      await expect(
        service.processRegistrationReferral('user-5', 'user-1', 'device-abused'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate referral (user already referred)', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-1',
        deviceFingerprint: 'device-a',
      });

      // referral.findUnique with referredId finds existing referral
      mockPrismaService.referral.findUnique.mockResolvedValue({
        id: 'existing-ref',
        referredId: 'user-2',
      });

      await expect(
        service.processRegistrationReferral('user-2', 'user-1', 'device-b'),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully process valid referral', async () => {
      // Referrer found, different device fingerprint
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-1',
        deviceFingerprint: 'device-referrer',
      });

      // No existing referral for this user
      mockPrismaService.referral.findUnique
        .mockResolvedValueOnce(null)   // existingReferral check
        .mockResolvedValueOnce(null);  // circular chain walk (referrer has no upstream)

      mockPrismaService.referral.create.mockResolvedValue({
        id: 'ref-1',
        referrerId: 'user-1',
        referredId: 'user-2',
      });

      mockPrismaService.referral.update.mockResolvedValue({});
      mockWalletService.awardReferralBonus.mockResolvedValue({});

      const result = await service.processRegistrationReferral(
        'user-2',
        'user-1',
        'device-clean',
      );

      expect(result).toBeDefined();
      expect(result.referralId).toBe('ref-1');
      expect(result.referrerId).toBe('user-1');
      expect(mockWalletService.awardReferralBonus).toHaveBeenCalledTimes(1);
    });

    it('should detect circular referral (A referred B, B tries to refer A)', async () => {
      // user-B is the referrer
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-B',
        deviceFingerprint: 'device-B',
      });

      // No existing referral for user-A
      mockPrismaService.referral.findUnique
        .mockResolvedValueOnce(null)                         // existingReferral check for user-A
        .mockResolvedValueOnce({ referrerId: 'user-A' });    // chain walk: user-B was referred by user-A → circular!

      await expect(
        service.processRegistrationReferral('user-A', 'user-B', 'device-A'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getReferralStats', () => {
    it('should return referral statistics', async () => {
      // Service calls referral.count twice: totalReferrals, rewardedReferrals
      mockPrismaService.referral.count
        .mockResolvedValueOnce(10)  // totalReferrals
        .mockResolvedValueOnce(8);  // rewardedReferrals

      const result = await service.getReferralStats('user-1');

      expect(result).toBeDefined();
      expect(result.totalReferrals).toBe(10);
      expect(result.rewardedReferrals).toBe(8);
      expect(result.referralCode).toBe('user-1');
    });
  });

  describe('getReferralHistory', () => {
    it('should return paginated referral history', async () => {
      mockPrismaService.referral.findMany.mockResolvedValue([
        { id: 'ref-1', referredId: 'user-2', createdAt: new Date() },
      ]);
      mockPrismaService.referral.count.mockResolvedValue(1);

      const result = await service.getReferralHistory('user-1', 1, 10);

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
