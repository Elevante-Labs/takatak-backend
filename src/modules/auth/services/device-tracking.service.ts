import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DeviceTrackingService {
  private readonly logger = new Logger(DeviceTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Track a device for a user — upsert UserDevice row.
   */
  async trackDevice(userId: string, deviceFingerprint?: string): Promise<void> {
    if (!deviceFingerprint) return;

    await this.prisma.userDevice.upsert({
      where: { userId_deviceFingerprint: { userId, deviceFingerprint } },
      update: { lastSeenAt: new Date() },
      create: { userId, deviceFingerprint },
    });
  }

  /**
   * Log an IP address for a user.
   */
  async trackIP(userId: string, ip: string): Promise<void> {
    if (!ip || ip === 'unknown') return;

    await this.prisma.userIP.create({
      data: { userId, ipAddress: ip },
    });
  }

  /**
   * Track both device and IP in parallel.
   */
  async track(userId: string, meta: { deviceFingerprint?: string; ip?: string }): Promise<void> {
    await Promise.all([
      this.trackDevice(userId, meta.deviceFingerprint),
      meta.ip ? this.trackIP(userId, meta.ip) : Promise.resolve(),
    ]);
  }

  /**
   * Count how many distinct users share a given device fingerprint.
   */
  async countUsersOnDevice(deviceFingerprint: string): Promise<number> {
    const result = await this.prisma.userDevice.groupBy({
      by: ['userId'],
      where: { deviceFingerprint },
    });
    return result.length;
  }
}
