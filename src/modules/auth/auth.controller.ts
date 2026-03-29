import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('otp/request')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.authService.requestOtp(dto, ip);
  }

  @Post('otp/verify')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.authService.verifyOtp(dto, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
