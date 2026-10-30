import { Module } from '@nestjs/common';
import { BackupsController } from './backups/backups.controller';
import { ReportsController } from './reports/reports.controller';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [ReportsController, BackupsController],
})
export class AdminModule {}
