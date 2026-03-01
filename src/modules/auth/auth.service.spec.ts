import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    otp: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    increment: jest.fn(),
    expire: jest.fn(),
    getClient: jest.fn().mockReturnValue({
      incr: jest.fn(),
      expire: jest.fn(),
      get: jest.fn(),
    }),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'jwt.accessSecret': 'test-access-secret',
        'jwt.refreshSecret': 'test-refresh-secret',
        'jwt.accessExpiresIn': '15m',
        'jwt.refreshExpiresIn': '7d',
        'otp.expiresInMinutes': 5,
        'otp.maxAttempts': 5,
        'wallet.signupGiftCoins': 100,
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('requestOtp', () => {
    it('should create and store OTP', async () => {
      mockRedisService.get.mockResolvedValue(null); // no rate limit hit
      mockRedisService.increment.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.otp.create.mockResolvedValue({
        id: 'otp-1',
        phone: '+1234567890',
        code: '123456',
        expiresAt: new Date(),
      });

      const result = await service.requestOtp({ phone: '+1234567890' } as any, '127.0.0.1');

      expect(result).toBeDefined();
      expect(mockPrismaService.otp.create).toHaveBeenCalled();
    });

    it('should rate limit OTP requests', async () => {
      mockRedisService.get.mockResolvedValue('5'); // 5 attempts, at limit

      await expect(
        service.requestOtp({ phone: '+1234567890' } as any, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('should verify valid OTP and return tokens', async () => {
      mockPrismaService.otp.findFirst.mockResolvedValue({
        id: 'otp-1',
        phone: '+1234567890',
        code: '123456',
        expiresAt: new Date(Date.now() + 300000), // 5 min from now
        verified: false,
        attempts: 0,
      });

      mockPrismaService.otp.update.mockResolvedValue({ id: 'otp-1', verified: true });

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+1234567890',
        role: 'USER',
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-123')
        .mockResolvedValueOnce('refresh-token-456');

      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.verifyOtp({ phone: '+1234567890', code: '123456' } as any, '127.0.0.1');

      expect(result.accessToken).toBe('access-token-123');
      expect(result.refreshToken).toBe('refresh-token-456');
    });

    it('should reject expired OTP', async () => {
      mockPrismaService.otp.findFirst.mockResolvedValue(null); // expired/not found

      await expect(
        service.verifyOtp({ phone: '+1234567890', code: '000000' } as any, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should create user and wallet on first login', async () => {
      mockPrismaService.otp.findFirst.mockResolvedValue({
        id: 'otp-2',
        phone: '+9999999999',
        code: '654321',
        expiresAt: new Date(Date.now() + 300000),
        verified: false,
        attempts: 0,
      });

      mockPrismaService.otp.update.mockResolvedValue({ id: 'otp-2', verified: true });

      // User doesn't exist yet
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      mockPrismaService.user.create.mockResolvedValue({
        id: 'new-user-1',
        phone: '+9999999999',
        role: 'USER',
        username: null,
        vipLevel: 0,
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce('access-new')
        .mockResolvedValueOnce('refresh-new');

      const result = await service.verifyOtp({ phone: '+9999999999', code: '654321' } as any, '127.0.0.1');

      expect(result.accessToken).toBe('access-new');
    });
  });

  describe('refreshToken', () => {
    it('should reject blacklisted refresh token', async () => {
      mockRedisService.exists.mockResolvedValue(1); // token is blacklisted

      await expect(
        service.refreshTokens({ refreshToken: 'blacklisted-token' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should issue new token pair for valid refresh token', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        phone: '+1234567890',
        role: 'USER',
      });

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+1234567890',
        role: 'USER',
        isActive: true,
        deletedAt: null,
      });

      mockRedisService.exists.mockResolvedValue(0); // not blacklisted
      mockRedisService.set.mockResolvedValue('OK');

      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      const result = await service.refreshTokens({ refreshToken: 'valid-refresh-token' } as any);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      // Old token should be blacklisted
      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should blacklist the refresh token', async () => {
      mockRedisService.set.mockResolvedValue('OK');

      await service.logout('refresh-token-to-blacklist');

      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });
});
