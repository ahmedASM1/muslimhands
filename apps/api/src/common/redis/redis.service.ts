import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../../config/configuration';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.client = new Redis(configService.get('redisUrl', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async ping(): Promise<string> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
