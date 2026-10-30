import { BadRequestException, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Roles } from '../common/decorators/roles.decorator';
import { BACKUP_FILE, BackupsService } from './backups.service';

@Roles(UserRole.ADMIN)
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Get('status')
  status() {
    return this.backups.status();
  }

  @Post()
  create() {
    return this.backups.create();
  }

  @Post('run-scheduled')
  @HttpCode(HttpStatus.OK)
  runScheduled() {
    return this.backups.runScheduled();
  }

  @Get(':name')
  download(@Param('name') name: string, @Res() res: Response) {
    if (!BACKUP_FILE.test(name)) {
      throw new BadRequestException('Nome de ficheiro invalido');
    }
    const file = join(this.backups.directory, name);
    if (!existsSync(file)) {
      throw new NotFoundException('Backup nao encontrado');
    }
    res.download(file, name);
  }
}
