import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../database/prisma.service';
import { randomBytes, createHash } from 'crypto';

export interface TokenPayload {
  sub: string;
  phone: string | null;
  email: string | null;
  role: string;
  provider: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Issue a new access + refresh token pair and persist session.
   */
  async issueTokens(
    payload: TokenPayload,
    meta: { userAgent?: string; ipAddress?: string },
  ): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: payload.sub, phone: payload.phone, email: payload.email, role: payload.role, provider: payload.provider } as any,
      {
        secret: this.configService.get<string>('jwt.accessSecret')!,
        expiresIn: this.configService.get<string>('jwt.accessExpiration')! as any,
      },
    );

    // Generate a cryptographically random refresh token
    const refreshToken = randomBytes(40).toString('hex');
    const refreshHash = this.hashToken(refreshToken);

    // Calculate expiry from config
    const refreshExpStr = this.configService.get<string>('jwt.refreshExpiration') || '7d';
    const expiresAt = this.parseExpiry(refreshExpStr);

    // Persist session in DB
    await this.prisma.session.create({
      data: {
        userId: payload.sub,
        refreshToken: refreshHash,
        userAgent: meta.userAgent?.slice(0, 500),
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Rotate refresh token: validate old, delete it, issue new pair.
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
    meta: { userAgent?: string; ipAddress?: string },
  ): Promise<TokenPair> {
    const oldHash = this.hashToken(oldRefreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshToken: oldHash },
      include: { user: { select: { id: true, phone: true, email: true, role: true, isActive: true, isBlocked: true, deletedAt: true } } },
    });

    if (!session) {
      this.logger.warn('Refresh token not found — possible reuse attack');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      // Clean up expired session
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!session.user.isActive || session.user.deletedAt) {
      throw new UnauthorizedException('User account is inactive');
    }

    if (session.user.isBlocked) {
      throw new UnauthorizedException('Account is blocked');
    }

    // Delete old session (rotate)
    await this.prisma.session.delete({ where: { id: session.id } });

    // Determine provider from the most recent auth provider
    const authProvider = await this.prisma.authProvider.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    });

    return this.issueTokens(
      {
        sub: session.user.id,
        phone: session.user.phone,
        email: session.user.email,
        role: session.user.role,
        provider: authProvider?.provider || 'phone',
      },
      meta,
    );
  }

  /**
   * Revoke a specific session by refresh token.
   */
  async revokeSession(refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.prisma.session.deleteMany({ where: { refreshToken: hash } });
  }

  /**
   * Revoke all sessions for a user.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Cleanup expired sessions (called by cron).
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiry(expr: string): Date {
    const match = expr.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7d

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * (ms[unit] || ms.d));
  }
}
