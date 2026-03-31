import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { RewardType } from '@prisma/client';

@Injectable()
export class AntiAbuseService {
  private readonly logger = new Logger(AntiAbuseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check if a signup bonus should be granted based on device/phone/IP history.
   * Does NOT block login — only prevents reward abuse.
   */
  async shouldGrantSignupBonus(meta: {
    deviceFingerprint?: string;
    phone?: string;
    ip?: string;
  }): Promise<boolean> {
    const maxAccountsPerDevice = this.configService.get<number>('fraud.maxAccountsPerDevice') || 2;

    // Check device: has this device already received a signup bonus?
    if (meta.deviceFingerprint) {
      const deviceRewards = await this.prisma.userReward.count({
        where: {
          deviceFingerprint: meta.deviceFingerprint,
          rewardType: RewardType.SIGNUP_BONUS,
          isGranted: true,
        },
      });
      if (deviceRewards >= maxAccountsPerDevice) {
        this.logger.warn(`Signup bonus denied — device ${meta.deviceFingerprint} already received ${deviceRewards} bonuses`);
        return false;
      }
    }

    // Check phone: has this phone already received a signup bonus?
    if (meta.phone) {
      const phoneRewards = await this.prisma.userReward.count({
        where: {
          phone: meta.phone,
          rewardType: RewardType.SIGNUP_BONUS,
          isGranted: true,
        },
      });
      if (phoneRewards >= 1) {
        this.logger.warn(`Signup bonus denied — phone ${meta.phone} already received bonus`);
        return false;
      }
    }

    return true;
  }

  /**
   * Record that a signup reward was granted.
   */
  async recordReward(
    userId: string,
    rewardType: RewardType,
    meta: { deviceFingerprint?: string; phone?: string; ip?: string },
  ): Promise<void> {
    await this.prisma.userReward.create({
      data: {
        userId,
        rewardType,
        isGranted: true,
        grantedAt: new Date(),
        deviceFingerprint: meta.deviceFingerprint,
        phone: meta.phone,
        ipAddress: meta.ip,
      },
    });
  }
}
