import { Injectable, InternalServerErrorException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const BACKUP_FILE = /^mavie-\d{8}-\d{6}\.sql$/;

export interface BackupStatus {
  enabled: boolean;
  hour: number | null;
  keepDays: number;
  copyDir: string | null;
  nextRunAt: Date | null;
  lastRun: { at: Date; ok: boolean; file?: string; copied?: boolean; error?: string } | null;
}

@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupsService.name);
  private timer: NodeJS.Timeout | null = null;
  private nextRunAt: Date | null = null;
  private lastRun: BackupStatus['lastRun'] = null;

  constructor(private readonly config: ConfigService) {}

  get directory() {
    return resolve(this.config.get<string>('BACKUP_DIR') ?? 'backups');
  }

  private get hour() {
    const raw = this.config.get<string>('BACKUP_AUTO_HOUR');
    if (raw === undefined || raw === '') return null;
    const hour = Number(raw);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  }

  private get keepDays() {
    const days = Number(this.config.get('BACKUP_KEEP_DAYS') ?? 14);
    return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 14;
  }

  private get copyDir() {
    const dir = this.config.get<string>('BACKUP_COPY_DIR');
    return dir ? resolve(dir) : null;
  }

  onModuleInit() {
    if (this.hour !== null && process.env.NODE_ENV !== 'test') this.schedule();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  status(): BackupStatus {
    return { enabled: this.hour !== null, hour: this.hour, keepDays: this.keepDays, copyDir: this.copyDir, nextRunAt: this.nextRunAt, lastRun: this.lastRun };
  }

  async list() {
    if (!existsSync(this.directory)) return [];
    const files = (await readdir(this.directory)).filter((name) => BACKUP_FILE.test(name));
    const entries = await Promise.all(
      files.map(async (name) => {
        const info = await stat(join(this.directory, name));
        return { name, size: info.size, createdAt: info.mtime };
      }),
    );
    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create() {
    const url = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    const database = url.pathname.replace(/^\//, '');
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `mavie-${stamp}.sql`;
    const file = join(this.directory, name);

    await new Promise<void>((done, fail) => {
      const child = spawn(
        this.config.get<string>('MYSQLDUMP_PATH') ?? 'mysqldump',
        [
          `--host=${url.hostname}`,
          `--port=${url.port || '3306'}`,
          `--user=${decodeURIComponent(url.username)}`,
          '--single-transaction',
          '--routines',
          `--result-file=${file}`,
          database,
        ],
        { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, windowsHide: true },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
      child.on('error', (error) => fail(new InternalServerErrorException(`Nao foi possivel executar o mysqldump: ${error.message}`)));
      child.on('close', (code) => (code === 0 ? done() : fail(new InternalServerErrorException(`mysqldump falhou: ${stderr.trim().slice(0, 300)}`))));
    });

    const info = await stat(file);
    return { name, size: info.size, createdAt: info.mtime };
  }

  async runScheduled() {
    try {
      const backup = await this.create();
      let copied = false;
      if (this.copyDir) {
        await mkdir(this.copyDir, { recursive: true });
        await copyFile(join(this.directory, backup.name), join(this.copyDir, backup.name));
        copied = true;
      }
      await this.prune(this.directory);
      if (this.copyDir) await this.prune(this.copyDir);
      this.lastRun = { at: new Date(), ok: true, file: backup.name, copied };
      this.logger.log(`Backup automatico ${backup.name}${copied ? ' copiado para a pasta externa' : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastRun = { at: new Date(), ok: false, error: message };
      this.logger.error(`Backup automatico falhou: ${message}`);
    }
    return this.lastRun;
  }

  private async prune(dir: string) {
    if (!existsSync(dir)) return;
    const limit = Date.now() - this.keepDays * 24 * 3600 * 1000;
    for (const name of (await readdir(dir)).filter((item) => BACKUP_FILE.test(item))) {
      const info = await stat(join(dir, name));
      if (info.mtime.getTime() < limit) await unlink(join(dir, name)).catch(() => undefined);
    }
  }

  private schedule() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.hour!, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    this.nextRunAt = next;
    this.timer = setTimeout(async () => {
      await this.runScheduled();
      this.schedule();
    }, next.getTime() - now.getTime());
    this.timer.unref();
  }
}
