import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Whitelist of keys that can be updated via admin API */
const ALLOWED_KEYS = [
  'DIAMOND_TO_COIN_RATIO',
  'MESSAGE_MAX_LENGTH',
  'VERIFIED_BOOST_MULTIPLIER',
  'MIN_WITHDRAWAL_DIAMONDS',
] as const;

@Injectable()
export class AdminSettingsService {
  private readonly logger = new Logger(AdminSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Get all system settings */
  async getAll() {
    return this.prisma.systemSettings.findMany({
      orderBy: { key: 'asc' },
    });
  }

  /** Get a single setting by key */
  async getByKey(key: string) {
    const setting = await this.prisma.systemSettings.findUnique({
      where: { key },
    });

    if (!setting) {
      throw new NotFoundException(`Setting '${key}' not found`);
    }

    return setting;
  }

  /** Update a setting value (admin only) */
  async updateSetting(key: string, value: string, adminId: string) {
    if (!ALLOWED_KEYS.includes(key as any)) {
      throw new BadRequestException(
        `Key '${key}' is not a recognized setting. Allowed: ${ALLOWED_KEYS.join(', ')}`,
      );
    }

    // Validate numeric values
    const numVal = Number(value);
    if (isNaN(numVal) || numVal <= 0) {
      throw new BadRequestException('Value must be a positive number');
    }

    const setting = await this.prisma.systemSettings.upsert({
      where: { key },
      update: {
        value,
        updatedBy: adminId,
      },
      create: {
        key,
        value,
        updatedBy: adminId,
      },
    });

    this.logger.log(
      `Setting '${key}' updated to '${value}' by admin ${adminId}`,
    );

    return setting;
  }
}
