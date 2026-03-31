import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../database/redis.service';
import { TokenService, TokenPair } from './token.service';
import { DeviceTrackingService } from './device-tracking.service';
import { AntiAbuseService } from './anti-abuse.service';
import { SmsProvider, SMS_PROVIDER } from './sms/sms-provider.interface';
import { normalizePhone } from '../utils/phone.util';
import { RewardType } from '@prisma/client';

const OTP_HASH_ROUNDS = 10;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly deviceTracking: DeviceTrackingService,
    private readonly antiAbuse: AntiAbuseService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  /**
   * Request OTP for a phone number.
   */
  async sendOtp(
    phone: string,
    ip: string,
  ): Promise<{ message: string; expiresInSeconds: number; otp?: string }> {
    // Normalize phone to E.164
    const normalizedPhone = normalizePhone(phone);

    // Rate limit: max 3 OTP requests per phone per minute
    await this.enforceRateLimit(`otp_rate:${normalizedPhone}`, 3, 60);
    // Rate limit: max 10 OTP requests per IP per minute
    await this.enforceRateLimit(`otp_ip_rate:${ip}`, 10, 60);
    // Daily cap: max 10 OTP per phone per day
    await this.enforceRateLimit(`otp_daily:${normalizedPhone}`, 10, 86400);
    // Daily cap: max 20 OTP per IP per day
    await this.enforceRateLimit(`otp_daily_ip:${ip}`, 20, 86400);

    // Generate OTP
    const mockCode = this.configService.get<string>('otp.mockCode');
    const otpCode = mockCode || this.generateSecureOtp();
    const codeHash = await bcrypt.hash(otpCode, OTP_HASH_ROUNDS);

    const expirationMinutes = this.configService.get<number>('otp.expirationMinutes') || 5;
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    // Find user if exists
    const user = await this.prisma.user.findUnique({ where: { phone: normalizedPhone } });

    // Store bcrypt-hashed OTP
    await this.prisma.otp.create({
      data: {
        phone: normalizedPhone,
        codeHash,
        expiresAt,
        userId: user?.id,
      },
    });

    // Send OTP via SMS provider
    if (!mockCode) {
      await this.smsProvider.sendOtp(normalizedPhone, otpCode);
    }

    this.logger.log(`OTP requested for ${normalizedPhone} from IP ${ip}`);

    return {
      message: 'OTP sent successfully',
      expiresInSeconds: expirationMinutes * 60,
      // Expose code in development only
      ...(this.configService.get('nodeEnv') === 'development' && { otp: otpCode }),
    };
  }

  /**
   * Verify OTP and authenticate user.
   */
  async verifyOtp(
    phone: string,
    code: string,
    meta: { ip: string; userAgent?: string; deviceFingerprint?: string; referralCode?: string },
  ): Promise<TokenPair & { isNewUser: boolean; user: Record<string, any> }> {
    // Normalize phone to E.164
    const normalizedPhone = normalizePhone(phone);

    // Find the most recent unused OTP for this phone
    const otp = await this.prisma.otp.findFirst({
      where: {
        phone: normalizedPhone,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const maxAttempts = this.configService.get<number>('otp.maxAttempts') || 5;
    if (otp.attempts >= maxAttempts) {
      throw new BadRequestException('Maximum OTP verification attempts exceeded');
    }

    // Increment attempts
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });

    // Compare bcrypt hash
    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid OTP code');
    }

    // Mark OTP as verified
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { phone: normalizedPhone } });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      // Device fingerprint fraud check via UserDevice table
      if (meta.deviceFingerprint) {
        const maxAccounts = this.configService.get<number>('fraud.maxAccountsPerDevice') || 2;
        const usersOnDevice = await this.deviceTracking.countUsersOnDevice(meta.deviceFingerprint);
        if (usersOnDevice >= maxAccounts) {
          throw new ConflictException('Maximum accounts per device exceeded');
        }
      }

      // Check if signup bonus should be granted
      const grantBonus = await this.antiAbuse.shouldGrantSignupBonus({
        deviceFingerprint: meta.deviceFingerprint,
        phone: normalizedPhone,
        ip: meta.ip,
      });

      user = await this.prisma.user.create({
        data: {
          phone: normalizedPhone,
          isVerified: true,
          lastLoginIp: meta.ip,
          wallet: { create: { giftCoins: grantBonus ? 100 : 0 } },
        },
      });

      // Track device + IP
      await this.deviceTracking.track(user.id, {
        deviceFingerprint: meta.deviceFingerprint,
        ip: meta.ip,
      });

      // Record signup bonus if granted
      if (grantBonus) {
        await this.antiAbuse.recordReward(user.id, RewardType.SIGNUP_BONUS, {
          deviceFingerprint: meta.deviceFingerprint,
          phone: normalizedPhone,
          ip: meta.ip,
        });
      }

      this.logger.log(`New user created via OTP: ${user.id} (bonus: ${grantBonus})`);
    } else {
      // Check blocked status
      if (user.isBlocked) {
        throw new UnauthorizedException('Account is blocked');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          lastLoginIp: meta.ip,
        },
      });

      // Track device + IP for existing user
      await this.deviceTracking.track(user.id, {
        deviceFingerprint: meta.deviceFingerprint,
        ip: meta.ip,
      });
    }

    // Ensure AuthProvider is linked
    await this.prisma.authProvider.upsert({
      where: { provider_providerId: { provider: 'phone', providerId: normalizedPhone } },
      update: {},
      create: { userId: user.id, provider: 'phone', providerId: normalizedPhone },
    });

    // Issue tokens
    const tokens = await this.tokenService.issueTokens(
      { sub: user.id, phone: user.phone, email: user.email, role: user.role, provider: 'phone' },
      { userAgent: meta.userAgent, ipAddress: meta.ip },
    );

    return {
      ...tokens,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        role: user.role,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        vipLevel: user.vipLevel,
      },
    };
  }

  private generateSecureOtp(): string {
    // Cryptographically random 6-digit OTP
    const array = new Uint32Array(1);
    require('crypto').getRandomValues(array);
    return String(100000 + (array[0] % 900000));
  }

  private async enforceRateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
    if (!this.redis.isAvailable) {
      this.logger.warn('Redis unavailable — skipping rate limit');
      return;
    }

    const current = await this.redis.get(key);
    if (current && parseInt(current, 10) >= max) {
      throw new BadRequestException('Too many requests. Try again later.');
    }

    await this.redis.increment(key);
    await this.redis.expire(key, windowSeconds);
  }
}
