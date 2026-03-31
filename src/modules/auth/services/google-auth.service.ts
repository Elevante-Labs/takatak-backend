import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../../database/prisma.service';
import { TokenService, TokenPair } from './token.service';
import { DeviceTrackingService } from './device-tracking.service';
import { AntiAbuseService } from './anti-abuse.service';
import { RewardType } from '@prisma/client';

interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly oauthClient: OAuth2Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly deviceTracking: DeviceTrackingService,
    private readonly antiAbuse: AntiAbuseService,
  ) {
    const clientId = this.configService.get<string>('google.clientId');
    this.oauthClient = new OAuth2Client(clientId);
  }

  /**
   * Authenticate with a Google ID token from the frontend.
   */
  async authenticate(
    idToken: string,
    meta: { ip: string; userAgent?: string; deviceFingerprint?: string },
  ): Promise<TokenPair & { isNewUser: boolean; user: Record<string, any> }> {
    const profile = await this.verifyToken(idToken);

    // Check if this Google account is already linked
    const existingProvider = await this.prisma.authProvider.findUnique({
      where: { provider_providerId: { provider: 'google', providerId: profile.sub } },
      include: { user: true },
    });

    let user: any;
    let isNewUser = false;

    if (existingProvider) {
      // Existing user — update profile data
      user = existingProvider.user;

      if (user.isBlocked) {
        throw new UnauthorizedException('Account is blocked');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginIp: meta.ip,
          ...(profile.name && !user.name && { name: profile.name }),
          ...(profile.picture && !user.avatarUrl && { avatarUrl: profile.picture }),
        },
      });

      // Track device + IP
      await this.deviceTracking.track(user.id, {
        deviceFingerprint: meta.deviceFingerprint,
        ip: meta.ip,
      });
    } else {
      // Check if a user with this email already exists (safe account merging)
      const existingUser = profile.email
        ? await this.prisma.user.findUnique({ where: { email: profile.email } })
        : null;

      if (existingUser && existingUser.isEmailVerified) {
        // Safe merge: only link when the existing account has a verified email
        user = existingUser;

        if (user.isBlocked) {
          throw new UnauthorizedException('Account is blocked');
        }

        await this.prisma.authProvider.create({
          data: {
            userId: existingUser.id,
            provider: 'google',
            providerId: profile.sub,
          },
        });

        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            isVerified: true,
            lastLoginIp: meta.ip,
            ...(profile.name && !existingUser.name && { name: profile.name }),
            ...(profile.picture && !existingUser.avatarUrl && { avatarUrl: profile.picture }),
          },
        });

        // Track device + IP
        await this.deviceTracking.track(user.id, {
          deviceFingerprint: meta.deviceFingerprint,
          ip: meta.ip,
        });

        this.logger.log(`Google account linked to existing user: ${existingUser.id}`);
      } else {
        // Brand new user (or existing user without verified email — create separate account)
        isNewUser = true;

        // Anti-abuse: check if signup bonus should be granted
        const grantBonus = await this.antiAbuse.shouldGrantSignupBonus({
          deviceFingerprint: meta.deviceFingerprint,
          ip: meta.ip,
        });

        user = await this.prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.picture,
            isVerified: profile.email_verified,
            isEmailVerified: profile.email_verified,
            lastLoginIp: meta.ip,
            wallet: { create: { giftCoins: grantBonus ? 100 : 0 } },
            authProviders: {
              create: { provider: 'google', providerId: profile.sub },
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

        this.logger.log(`New user created via Google: ${user.id} (bonus: ${grantBonus})`);
      }
    }

    const tokens = await this.tokenService.issueTokens(
      { sub: user.id, phone: user.phone, email: user.email, role: user.role, provider: 'google' },
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

  private async verifyToken(idToken: string): Promise<GoogleProfile> {
    try {
      const clientId = this.configService.get<string>('google.clientId');
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Invalid Google token payload');
      }

      return {
        sub: payload.sub,
        email: payload.email || '',
        name: payload.name || '',
        picture: payload.picture || '',
        email_verified: payload.email_verified || false,
      };
    } catch (error) {
      this.logger.warn(`Google token verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired Google token');
    }
  }
}
