import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prismaClientClass } from './database';

@Injectable()
export class PrismaService extends prismaClientClass() implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
