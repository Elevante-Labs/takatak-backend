import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    // Database check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch {
      checks.database = 'disconnected';
    }

    // Redis check
    try {
      await this.redis.set('health:check', 'ok', 10);
      const result = await this.redis.get('health:check');
      checks.redis = result === 'ok' ? 'connected' : 'disconnected';
    } catch {
      checks.redis = 'disconnected';
    }

    const allHealthy =
      checks.database === 'connected' && checks.redis === 'connected';
    checks.status = allHealthy ? 'ok' : 'degraded';

    return checks;
  }

  @Get('ping')
  ping() {
    return { pong: true, timestamp: new Date().toISOString() };
  }
}
