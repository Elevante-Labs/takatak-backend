import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import { GoogleAuthService } from './services/google-auth.service';
import { EmailAuthService } from './services/email-auth.service';
import { DeviceTrackingService } from './services/device-tracking.service';
import { AntiAbuseService } from './services/anti-abuse.service';
import { SMS_PROVIDER } from './services/sms/sms-provider.interface';
import { MockSmsProvider } from './services/sms/mock-sms.provider';
import { TwilioSmsProvider } from './services/sms/twilio-sms.provider';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret')!,
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiration')! as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    TokenService,
    OtpService,
    GoogleAuthService,
    EmailAuthService,
    DeviceTrackingService,
    AntiAbuseService,
    {
      provide: SMS_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('sms.provider');
        if (provider === 'twilio') {
          return new TwilioSmsProvider(configService);
        }
        return new MockSmsProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [TokenService, JwtModule],
})
export class AuthModule {}
