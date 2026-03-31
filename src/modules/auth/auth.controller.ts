import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { OtpService } from './services/otp.service';
import { GoogleAuthService } from './services/google-auth.service';
import { EmailAuthService } from './services/email-auth.service';
import { TokenService } from './services/token.service';
import {
  RequestOtpDto,
  VerifyOtpDto,
  RefreshTokenDto,
  GoogleLoginDto,
  EmailRegisterDto,
  EmailLoginDto,
} from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otpService: OtpService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailAuthService: EmailAuthService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Google OAuth ──────────────────────────────────

  @Post('google')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    return this.googleAuthService.authenticate(dto.idToken, { ip, userAgent, deviceFingerprint: dto.deviceFingerprint });
  }

  // ─── Email + Password ─────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: EmailRegisterDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    return this.emailAuthService.register(dto.email, dto.password, dto.name, { ip, userAgent, deviceFingerprint: dto.deviceFingerprint });
  }

  @Post('login')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: EmailLoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    return this.emailAuthService.login(dto.email, dto.password, { ip, userAgent, deviceFingerprint: dto.deviceFingerprint });
  }

  // ─── Mobile OTP ───────────────────────────────────

  @Post('otp/send')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.otpService.sendOtp(dto.phone, ip);
  }

  @Post('otp/verify')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    return this.otpService.verifyOtp(dto.phone, dto.code, {
      ip,
      userAgent,
      deviceFingerprint: dto.deviceFingerprint,
      referralCode: dto.referralCode,
    });
  }

  // ─── Token Management ─────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    return this.tokenService.rotateRefreshToken(dto.refreshToken, { userAgent, ipAddress: ip });
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.tokenService.revokeSession(dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  // ─── User Info ────────────────────────────────────

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@CurrentUser() user: JwtPayload) {
    return this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        avatarUrl: true,
        role: true,
        vipLevel: true,
        isVerified: true,
        createdAt: true,
        authProviders: {
          select: { provider: true, createdAt: true },
        },
      },
    });
  }
}
