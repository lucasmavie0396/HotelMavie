import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { PublicDomainController } from './public-domain.controller';
import { PublicController } from './public.controller';

@Module({
  imports: [ReservationsModule, BillingModule],
  controllers: [PublicController, PublicDomainController],
})
export class PublicModule {}
