import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) { }

  async requestOtp(dto: RequestOtpDto, ip: string) {
    // Rate limit check via Redis (skipped if Redis is unavailable)
    if (!this.redis.isAvailable) {
      this.logger.warn('Redis unavailable — skipping OTP rate limiting');
    } else {
      const rateLimitKey = `otp_rate:${dto.phone}`;
      const attempts = await this.redis.get(rateLimitKey);

      if (attempts && parseInt(attempts) >= 5) {
        throw new BadRequestException('Too many OTP requests. Try again later.');
      }
    }

    // Generate OTP (mock in development)
    const otpCode =
      this.configService.get<string>('otp.mockCode') ||
      Math.floor(100000 + Math.random() * 900000).toString();

    const expirationMinutes = this.configService.get<number>('otp.expirationMinutes') || 5;
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    // Find or create user placeholder
    let user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    await this.prisma.otp.create({
      data: {
        phone: dto.phone,
        codeHash: otpCode,
        expiresAt,
        userId: user?.id,
      },
    });

    // Increment rate limit (only if Redis is available)
    if (this.redis.isAvailable) {
      const rateLimitKey = `otp_rate:${dto.phone}`;
      await this.redis.increment(rateLimitKey);
      await this.redis.expire(rateLimitKey, 300); // 5 minutes window
    }

    this.logger.log(`OTP requested for ${dto.phone} from IP ${ip}`);

    return {
      message: 'OTP sent successfully',
      expiresInSeconds: expirationMinutes * 60,
      // Only expose in development
      ...(this.configService.get('nodeEnv') === 'development' && { otp: otpCode }),
    };
  }

  async verifyOtp(dto: VerifyOtpDto, ip: string) {
    const otp = await this.prisma.otp.findFirst({
      where: {
        phone: dto.phone,
        codeHash: dto.code,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (otp.attempts >= 5) {
      throw new BadRequestException('Maximum OTP verification attempts exceeded');
    }

    // Mark OTP as verified
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { verified: true, attempts: { increment: 1 } },
    });

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      // Check device fingerprint fraud
      if (dto.deviceFingerprint) {
        const maxAccounts = this.configService.get<number>('fraud.maxAccountsPerDevice') || 2;
        const existingDevices = await this.prisma.userDevice.groupBy({
          by: ['userId'],
          where: { deviceFingerprint: dto.deviceFingerprint },
        });

        if (existingDevices.length >= maxAccounts) {
          this.logger.warn(
            `Device fingerprint ${dto.deviceFingerprint} exceeded max accounts (${maxAccounts})`,
          );
          throw new ConflictException('Maximum accounts per device exceeded');
        }
      }

      user = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          isVerified: true,
          lastLoginIp: ip,
          wallet: {
            create: {
              giftCoins: 100, // Welcome bonus
            },
          },
        },
      });

      this.logger.log(`New user created: ${user.id} (${dto.phone})`);
    } else {
      // Update existing user
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          lastLoginIp: ip,
        },
      });
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.phone || '', user.role);

    return {
      ...tokens,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        username: user.username,
        vipLevel: user.vipLevel,
      },
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      this.logger.debug(`[Refresh] JWT verified for user ${payload.sub}`);

      // Verify user still exists and is active
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, phone: true, role: true, isActive: true, deletedAt: true },
      });

      if (!user || !user.isActive || user.deletedAt) {
        this.logger.warn(`[Refresh] User inactive or deleted: ${payload.sub}`);
        throw new UnauthorizedException('User account is inactive');
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.redis.exists(`blacklist:${dto.refreshToken}`);
      if (isBlacklisted) {
        this.logger.warn(`[Refresh] Token already blacklisted for user ${payload.sub}`);
        throw new UnauthorizedException('Token has been revoked');
      }

      // Blacklist old refresh token
      await this.redis.set(`blacklist:${dto.refreshToken}`, '1', 7 * 24 * 60 * 60);

      return this.generateTokens(user.id, user.phone || '', user.role);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(`[Refresh] JWT verify failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(refreshToken: string) {
    await this.redis.set(`blacklist:${refreshToken}`, '1', 7 * 24 * 60 * 60);
    return { message: 'Logged out successfully' };
  }

  private async generateTokens(userId: string, phone: string, role: string) {
    const payload = { sub: userId, phone, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.accessSecret')!,
        expiresIn: this.configService.get<string>('jwt.accessExpiration')! as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret')!,
        expiresIn: this.configService.get<string>('jwt.refreshExpiration')! as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
