import { Module } from '@nestjs/common';
import { BackupsController } from './backups/backups.controller';
import { ReportsController } from './reports/reports.controller';

@Module({
  controllers: [ReportsController, BackupsController],
})
export class AdminModule {}
