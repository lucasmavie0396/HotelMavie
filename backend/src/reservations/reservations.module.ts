import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DepositService } from './deposit.service';
import { ReservationGroupsController } from './reservation-groups.controller';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [BillingModule],
  controllers: [ReservationsController, ReservationGroupsController],
  providers: [ReservationsService, DepositService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
