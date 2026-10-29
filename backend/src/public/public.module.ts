import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { PublicController } from './public.controller';

@Module({
  imports: [ReservationsModule, BillingModule],
  controllers: [PublicController],
})
export class PublicModule {}
