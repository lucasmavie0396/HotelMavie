import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { PublicController } from './public.controller';

@Module({
  imports: [ReservationsModule],
  controllers: [PublicController],
})
export class PublicModule {}
