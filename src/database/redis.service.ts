import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private subscriber!: Redis;
  private _isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  /** Whether the Redis client is connected and usable. */
  get isAvailable(): boolean {
    return this._isConnected;
  }

  async onModuleInit() {
    const host = this.configService.get<string>('redis.host');
    const port = this.configService.get<number>('redis.port');

    // If no Redis host is configured (or it's the default localhost in a
    // cloud environment), skip connecting entirely.
    if (!host) {
      this.logger.warn('No REDIS_HOST configured — Redis features disabled');
      return;
    }

    const redisConfig = {
      host,
      port,
      password: this.configService.get<string>('redis.password') || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          this.logger.error('Redis connection failed after 3 retries — running without Redis');
          this._isConnected = false;
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
    };

    try {
      this.client = new Redis(redisConfig);
      this.subscriber = new Redis(redisConfig);

      this.client.on('connect', () => {
        this._isConnected = true;
        this.logger.log('Redis client connected');
      });
      this.client.on('error', (err) => {
        this._isConnected = false;
        this.logger.error('Redis client error', err.message);
      });
      this.client.on('close', () => {
        this._isConnected = false;
      });

      this.subscriber.on('connect', () => this.logger.log('Redis subscriber connected'));
      this.subscriber.on('error', (err) => this.logger.error('Redis subscriber error', err.message));

      // Quick connectivity check — if it fails, we still boot.
      await this.client.ping();
      this._isConnected = true;
    } catch (e) {
      this._isConnected = false;
      this.logger.warn(`Redis not reachable (${(e as Error).message}) — running without Redis`);
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit().catch(() => {});
    if (this.subscriber) await this.subscriber.quit().catch(() => {});
    this.logger.log('Redis connections closed');
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  async get(key: string): Promise<string | null> {
    if (!this._isConnected) return null;
    try { return await this.client.get(key); } catch { return null; }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this._isConnected) return;
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch { /* Redis unavailable — skip silently */ }
  }

  async del(key: string): Promise<void> {
    if (!this._isConnected) return;
    try { await this.client.del(key); } catch { /* skip */ }
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this._isConnected) return;
    try { await this.client.publish(channel, message); } catch { /* skip */ }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this._isConnected || !this.subscriber) return;
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) {
        callback(msg);
      }
    });
  }

  async psubscribe(pattern: string, callback: (channel: string, message: string) => void): Promise<void> {
    if (!this._isConnected || !this.subscriber) return;
    await this.subscriber.psubscribe(pattern);
    this.subscriber.on('pmessage', (_pat, ch, msg) => {
      callback(ch, msg);
    });
  }

  async increment(key: string): Promise<number> {
    if (!this._isConnected) return 0;
    try { return await this.client.incr(key); } catch { return 0; }
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (!this._isConnected) return;
    try { await this.client.expire(key, seconds); } catch { /* skip */ }
  }

  async exists(key: string): Promise<boolean> {
    if (!this._isConnected) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch { return false; }
  }
}
