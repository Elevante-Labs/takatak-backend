import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private client: any;
  private fromNumber: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('sms.twilio.accountSid');
    const authToken = this.configService.get<string>('sms.twilio.authToken');
    this.fromNumber = this.configService.get<string>('sms.twilio.fromNumber') || '';

    if (accountSid && authToken) {
      // Lazy-load twilio to avoid hard dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilio = require('twilio');
      this.client = twilio(accountSid, authToken);
    }
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!this.client) {
      this.logger.error('Twilio client not initialized — check credentials');
      throw new Error('SMS provider not configured');
    }

    await this.client.messages.create({
      body: `Your verification code is: ${code}. Valid for 5 minutes.`,
      from: this.fromNumber,
      to: phone,
    });

    this.logger.log(`OTP sent to ${phone} via Twilio`);
  }
}
