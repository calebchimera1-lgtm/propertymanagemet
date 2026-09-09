import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@pm/database';
import { AppConfig } from '@/config/app.config';

/**
 * The raw, UNSCOPED Prisma client.
 *
 * Injecting this bypasses the tenant filter, so it is deliberately the more
 * awkward of the two clients to reach for. Legitimate users are:
 *   • authentication (looking up a user before any organization is known)
 *   • scheduled jobs and the seed, which run outside a request
 *   • the isolation tests, which need to see across organizations to prove
 *     the application cannot
 *
 * Everything else must inject the scoped client (see tenant-scope.extension.ts).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
