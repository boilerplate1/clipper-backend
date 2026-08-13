import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  available = false;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$queryRaw`SELECT 1`;
      this.available = true;
      this.logger.log('PostgreSQL connection established (Prisma).');
    } catch (e: any) {
      this.available = false;
      this.logger.warn(
        `PostgreSQL unavailable (${e.message}). Falling back to in-memory job store.`,
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (e: any) {
      this.logger.warn(`Prisma disconnect failed: ${e.message}`);
    }
  }
}
