import { Test, TestingModule } from '@nestjs/testing';
import { HostDashboardService } from './host-dashboard.service';
import { PrismaService } from '../../database/prisma.service';

describe('HostDashboardService', () => {
  let service: HostDashboardService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
    transaction: {
      aggregate: jest.fn(),
    },
    message: {
      count: jest.fn(),
    },
    chat: {
      count: jest.fn(),
    },
    withdrawalRequest: {
      aggregate: jest.fn(),
    },
    follow: {
      count: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HostDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<HostDashboardService>(HostDashboardService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboard', () => {
    it('should aggregate dashboard data for host', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'host-1',
        role: 'HOST',
        isVerified: true,
      });
      mockPrismaService.wallet.findUnique.mockResolvedValue({
        diamonds: 500,
        promoDiamonds: 50,
        giftCoins: 100,
        gameCoins: 100,
      });
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        value: '10',
      });
      mockPrismaService.transaction.aggregate.mockResolvedValueOnce({
        _sum: { amount: 100 },
      }); // today diamonds
      mockPrismaService.transaction.aggregate.mockResolvedValueOnce({
        _sum: { amount: 2000 },
      }); // total diamonds
      mockPrismaService.message.count.mockResolvedValue(150);
      mockPrismaService.chat.count.mockResolvedValue(5);
      mockPrismaService.withdrawalRequest.aggregate.mockResolvedValue({
        _sum: { diamondAmount: 200 },
      });
      mockPrismaService.follow.count.mockResolvedValue(42);

      const result = await service.getDashboard('host-1');

      expect(result.isVerified).toBe(true);
      expect(result.balance.diamonds).toBe(500);
      expect(result.followerCount).toBe(42);
      expect(result.conversionRatio).toBe(10);
    });

    it('should use default conversion ratio when setting not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'host-1',
        role: 'HOST',
        isVerified: false,
      });
      mockPrismaService.wallet.findUnique.mockResolvedValue({
        diamonds: 0,
        promoDiamonds: 0,
        giftCoins: 0,
        gameCoins: 0,
      });
      mockPrismaService.systemSettings.findUnique.mockResolvedValue(null);
      mockPrismaService.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      mockPrismaService.message.count.mockResolvedValue(0);
      mockPrismaService.chat.count.mockResolvedValue(0);
      mockPrismaService.withdrawalRequest.aggregate.mockResolvedValue({
        _sum: { diamondAmount: null },
      });
      mockPrismaService.follow.count.mockResolvedValue(0);

      const result = await service.getDashboard('host-1');

      expect(result.conversionRatio).toBe(10);
      expect(result.todayDiamonds).toBe(0);
    });
  });
});
