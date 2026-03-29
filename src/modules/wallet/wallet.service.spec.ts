import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../database/prisma.service';

describe('WalletService', () => {
  let service: WalletService;

  const mockPrismaService = {
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'wallet.coinToDiamondRatio': 1,
        'wallet.messageCoinCost': 10,
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBalance', () => {
    it('should return wallet balance with totalCoins', async () => {
      const mockWallet = {
        giftCoins: 100,
        gameCoins: 50,
        diamonds: 30,
        promoDiamonds: 10,
      };
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.getBalance('user-1');

      expect(result).toEqual({
        giftCoins: 100,
        gameCoins: 50,
        diamonds: 30,
        promoDiamonds: 10,
        totalCoins: 150,
      });
    });

    it('should throw NotFoundException when wallet not found', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getBalance('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recharge - idempotency', () => {
    it('should skip duplicate recharge with same idempotency key', async () => {
      const existingTx = {
        id: 'tx-1',
        coinAmount: 100,
        diamondAmount: 0,
        type: 'RECHARGE',
        status: 'COMPLETED',
      };
      mockPrismaService.transaction.findUnique.mockResolvedValue(existingTx);

      const result = await service.recharge(
        'user-1',
        100,
        'GIFT' as any,
        'test',
        'idem-key-1',
      );

      expect(result).toEqual({
        transactionId: 'tx-1',
        coinAmount: 100,
        diamondAmount: 0,
        status: 'COMPLETED',
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject zero or negative amount', async () => {
      await expect(
        service.recharge('user-1', 0, 'GAME' as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processChatPayment', () => {
    it('should reject self-payment', async () => {
      await expect(
        service.processChatPayment({
          senderId: 'user-1',
          receiverId: 'user-1',
          coinCost: 10,
          diamondGenerated: 10,
          usePromoDiamonds: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject zero or negative coin cost', async () => {
      await expect(
        service.processChatPayment({
          senderId: 'sender-1',
          receiverId: 'receiver-1',
          coinCost: 0,
          diamondGenerated: 0,
          usePromoDiamonds: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deductDiamondsForWithdrawal', () => {
    it('should throw if insufficient diamonds', async () => {
      mockPrismaService.transaction.findUnique.mockResolvedValue(null);

      mockPrismaService.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          wallet: { update: jest.fn() },
          transaction: { create: jest.fn() },
          $queryRaw: jest.fn().mockResolvedValue([
            { id: 'w-1', diamonds: 5, promoDiamonds: 0 },
          ]),
        });
      });

      await expect(
        service.deductDiamondsForWithdrawal('user-1', 100),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTransactionHistory', () => {
    it('should return paginated transactions', async () => {
      const mockTxs = [
        { id: 'tx-1', amount: 100, type: 'RECHARGE', status: 'COMPLETED' },
      ];
      mockPrismaService.transaction.findMany.mockResolvedValue(mockTxs);
      mockPrismaService.transaction.count.mockResolvedValue(1);

      const result = await service.getTransactionHistory('user-1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
