import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../database/redis.service';
import { TokenService, TokenPair } from './token.service';
import { DeviceTrackingService } from './device-tracking.service';
import { AntiAbuseService } from './anti-abuse.service';
import { RewardType } from '@prisma/client';

const BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class EmailAuthService {
  private readonly logger = new Logger(EmailAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: TokenService,
    private readonly deviceTracking: DeviceTrackingService,
    private readonly antiAbuse: AntiAbuseService,
  ) {}

  /**
   * Register a new user with email + password.
   */
  async register(
    email: string,
    password: string,
    name: string | undefined,
    meta: { ip: string; userAgent?: string; deviceFingerprint?: string },
  ): Promise<TokenPair & { user: Record<string, any> }> {
    // Check if email is already taken
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Anti-abuse: check if signup bonus should be granted
    const grantBonus = await this.antiAbuse.shouldGrantSignupBonus({
      deviceFingerprint: meta.deviceFingerprint,
      ip: meta.ip,
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        isVerified: false,
        isEmailVerified: false,
        lastLoginIp: meta.ip,
        wallet: { create: { giftCoins: grantBonus ? 100 : 0 } },
        authProviders: {
          create: { provider: 'email', providerId: email },
        },
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
        ip: meta.ip,
      });
    }

    this.logger.log(`New user registered via email: ${user.id} (bonus: ${grantBonus})`);

    const tokens = await this.tokenService.issueTokens(
      { sub: user.id, phone: user.phone, email: user.email, role: user.role, provider: 'email' },
      { userAgent: meta.userAgent, ipAddress: meta.ip },
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        vipLevel: user.vipLevel,
      },
    };
  }

  /**
   * Login with email + password.
   */
  async login(
    email: string,
    password: string,
    meta: { ip: string; userAgent?: string; deviceFingerprint?: string },
  ): Promise<TokenPair & { user: Record<string, any> }> {
    // Rate limit: max 5 login attempts per IP per minute
    await this.enforceLoginRateLimit(meta.ip);

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Account is inactive or deleted');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Account is blocked');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginIp: meta.ip },
    });

    // Track device + IP
    await this.deviceTracking.track(user.id, {
      deviceFingerprint: meta.deviceFingerprint,
      ip: meta.ip,
    });

    const tokens = await this.tokenService.issueTokens(
      { sub: user.id, phone: user.phone, email: user.email, role: user.role, provider: 'email' },
      { userAgent: meta.userAgent, ipAddress: meta.ip },
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        vipLevel: user.vipLevel,
      },
    };
  }

  private async enforceLoginRateLimit(ip: string): Promise<void> {
    if (!this.redis.isAvailable) return;

    const key = `login_rate:${ip}`;
    const current = await this.redis.get(key);
    if (current && parseInt(current, 10) >= 5) {
      throw new BadRequestException('Too many login attempts. Try again later.');
    }
    await this.redis.increment(key);
    await this.redis.expire(key, 60);
  }
}
