import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

describe('WithdrawalService', () => {
  let service: WithdrawalService;

  const mockPrismaService = {
    systemSettings: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    withdrawalRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockWalletService = {
    deductDiamondsForWithdrawal: jest.fn(),
    refundWithdrawalDiamonds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WalletService, useValue: mockWalletService },
      ],
    }).compile();

    service = module.get<WithdrawalService>(WithdrawalService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWithdrawalRequest', () => {
    it('should reject non-positive amount', async () => {
      await expect(
        service.createWithdrawalRequest('user-1', 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject amount below minimum', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        key: 'MIN_WITHDRAWAL_DIAMONDS',
        value: '100',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: 'HOST',
      });

      await expect(
        service.createWithdrawalRequest('host-1', 50),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-HOST users', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        key: 'MIN_WITHDRAWAL_DIAMONDS',
        value: '100',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: 'USER',
      });

      await expect(
        service.createWithdrawalRequest('user-1', 200),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should create withdrawal request for HOST', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        key: 'MIN_WITHDRAWAL_DIAMONDS',
        value: '100',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: 'HOST',
      });
      mockWalletService.deductDiamondsForWithdrawal.mockResolvedValue({
        transactionId: 'tx-w1',
      });
      mockPrismaService.withdrawalRequest.create.mockResolvedValue({
        id: 'wr-1',
        userId: 'host-1',
        diamondAmount: 200,
        status: 'PENDING',
      });

      const result = await service.createWithdrawalRequest('host-1', 200);

      expect(result.status).toBe('PENDING');
      expect(mockWalletService.deductDiamondsForWithdrawal).toHaveBeenCalled();
    });
  });

  describe('approveWithdrawal', () => {
    it('should throw if request not found', async () => {
      mockPrismaService.withdrawalRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.approveWithdrawal('wr-1', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if request is not PENDING', async () => {
      mockPrismaService.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        status: 'APPROVED',
      });

      await expect(
        service.approveWithdrawal('wr-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should approve PENDING withdrawal', async () => {
      mockPrismaService.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        status: 'PENDING',
      });
      mockPrismaService.withdrawalRequest.update.mockResolvedValue({
        id: 'wr-1',
        status: 'APPROVED',
        processedBy: 'admin-1',
      });

      const result = await service.approveWithdrawal('wr-1', 'admin-1');

      expect(result.status).toBe('APPROVED');
    });
  });

  describe('rejectWithdrawal', () => {
    it('should refund diamonds and mark REJECTED', async () => {
      mockPrismaService.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-2',
        userId: 'host-1',
        diamondAmount: 200,
        status: 'PENDING',
      });
      mockWalletService.refundWithdrawalDiamonds.mockResolvedValue({});
      mockPrismaService.withdrawalRequest.update.mockResolvedValue({
        id: 'wr-2',
        status: 'REJECTED',
        adminNote: 'Not eligible',
      });

      const result = await service.rejectWithdrawal(
        'wr-2',
        'admin-1',
        'Not eligible',
      );

      expect(result.status).toBe('REJECTED');
      expect(mockWalletService.refundWithdrawalDiamonds).toHaveBeenCalledWith(
        'host-1',
        200,
      );
    });
  });

  describe('getUserWithdrawals', () => {
    it('should return paginated results', async () => {
      mockPrismaService.withdrawalRequest.findMany.mockResolvedValue([
        { id: 'wr-1', diamondAmount: 100, status: 'PENDING' },
      ]);
      mockPrismaService.withdrawalRequest.count.mockResolvedValue(1);

      const result = await service.getUserWithdrawals('host-1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
