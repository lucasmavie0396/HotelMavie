import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, RoomStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { BACKUP_FILE, BackupsService } from '../backups/backups.service';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';

export const CONFIRMATION = 'APAGAR DADOS DE TESTE';
const MIN_BACKUPS = 7;
const MIN_EMAIL_DAYS = 30;

export class StartProductionDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsBoolean()
  deleteTestData: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  confirmation?: string;
}

export class CleanupDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsIn(['BACKUPS', 'SESSIONS', 'EMAIL_LOGS'])
  type: 'BACKUPS' | 'SESSIONS' | 'EMAIL_LOGS';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  value?: number;
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
    private readonly audit: AuditService,
  ) {}

  async status(hotelIdParam: number | undefined, user: JwtPayload) {
    const hotel = await this.hotel(user, hotelIdParam);
    return { inProduction: Boolean(hotel.productionSince), since: hotel.productionSince, confirmation: CONFIRMATION, counts: await this.counts(hotel.id) };
  }

  async start(dto: StartProductionDto, user: JwtPayload) {
    const hotel = await this.hotel(user, dto.hotelId);
    if (hotel.productionSince) {
      throw new ConflictException('Este hotel ja esta em producao: os dados ja nao se podem apagar');
    }
    if (dto.deleteTestData && dto.confirmation?.trim() !== CONFIRMATION) {
      throw new BadRequestException(`Para apagar os dados de teste escreva exatamente ${CONFIRMATION}`);
    }
    const counts = await this.counts(hotel.id);
    let backup: string | null = null;
    if (dto.deleteTestData) {
      backup = (await this.backups.create()).name;
    }
    const since = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const { count } = await tx.hotel.updateMany({ where: { id: hotel.id, productionSince: null }, data: { productionSince: since } });
        if (!count) throw new ConflictException('Este hotel ja esta em producao: os dados ja nao se podem apagar');
        if (dto.deleteTestData) await this.wipe(tx, hotel.id);
        await this.audit.log(
          {
            hotelId: hotel.id,
            userId: user.sub,
            action: 'PRODUCTION_START',
            entity: 'hotel',
            entityId: hotel.id,
            summary: dto.deleteTestData
              ? `Inicio da producao com os dados de teste apagados (copia ${backup}): ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ')}`
              : 'Inicio da producao mantendo os dados existentes',
            data: { counts, backup },
          },
          tx,
        );
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    return { since, deleted: dto.deleteTestData, backup, counts };
  }

  async cleanupStatus(hotelIdParam: number | undefined, user: JwtPayload) {
    const hotel = await this.hotel(user, hotelIdParam);
    const files = await this.backupFiles();
    const old = files.slice(MIN_BACKUPS);
    const emailLimit = new Date(Date.now() - MIN_EMAIL_DAYS * 86_400_000);
    return {
      items: [
        {
          type: 'BACKUPS',
          count: old.length,
          bytes: old.reduce((sum, file) => sum + file.size, 0),
          minimum: MIN_BACKUPS,
          location: this.backups.directory,
          total: files.length,
        },
        { type: 'SESSIONS', count: await this.prisma.userSession.count({ where: { expiresAt: { lt: new Date() } } }), minimum: 0 },
        { type: 'EMAIL_LOGS', count: await this.prisma.emailLog.count({ where: { hotelId: hotel.id, createdAt: { lt: emailLimit } } }), minimum: MIN_EMAIL_DAYS },
      ],
    };
  }

  async cleanup(dto: CleanupDto, user: JwtPayload) {
    const hotel = await this.hotel(user, dto.hotelId);
    let removed = 0;
    let detail = '';
    if (dto.type === 'BACKUPS') {
      const keep = Math.max(MIN_BACKUPS, dto.value ?? MIN_BACKUPS);
      const old = (await this.backupFiles()).slice(keep);
      for (const file of old) {
        await unlink(file.path);
        removed++;
      }
      detail = `copias de seguranca antigas (ficam as ${keep} mais recentes)`;
    } else if (dto.type === 'SESSIONS') {
      removed = (await this.prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
      removed += (await this.prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
      detail = 'sessoes e pedidos de password expirados';
    } else {
      const days = Math.max(MIN_EMAIL_DAYS, dto.value ?? 90);
      removed = (await this.prisma.emailLog.deleteMany({ where: { hotelId: hotel.id, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } })).count;
      detail = `registos de emails com mais de ${days} dias`;
    }
    await this.audit.log({ hotelId: hotel.id, userId: user.sub, action: 'CLEANUP', entity: 'system', summary: `Limpeza tecnica: ${removed} ${detail}` });
    return { type: dto.type, removed };
  }

  private async backupFiles() {
    const dir = this.backups.directory;
    if (!existsSync(dir)) return [];
    const files = [];
    for (const name of (await readdir(dir)).filter((item) => BACKUP_FILE.test(item))) {
      const info = await stat(join(dir, name));
      files.push({ name, path: join(dir, name), size: info.size, time: info.mtime.getTime() });
    }
    return files.sort((a, b) => b.time - a.time);
  }

  private async counts(hotelId: number) {
    const [reservations, guests, invoices, payments, orders, cashSessions, stockMovements, purchases, stockDocuments, eventCards, payrollRuns, timeEntries] = [
      await this.prisma.reservation.count({ where: { hotelId } }),
      await this.prisma.guest.count({ where: { hotelId } }),
      await this.prisma.invoice.count({ where: { hotelId } }),
      await this.prisma.payment.count({ where: { hotelId } }),
      await this.prisma.order.count({ where: { hotelId } }),
      await this.prisma.cashSession.count({ where: { register: { hotelId } } }),
      await this.prisma.stockMovement.count({ where: { warehouse: { hotelId } } }),
      await this.prisma.purchase.count({ where: { hotelId } }),
      await this.prisma.stockDocument.count({ where: { hotelId } }),
      await this.prisma.eventCard.count({ where: { hotelId } }),
      await this.prisma.payrollRun.count({ where: { hotelId } }),
      await this.prisma.timeEntry.count({ where: { hotelId } }),
    ];
    return { reservations, guests, invoices, payments, orders, cashSessions, stockMovements, purchases, stockDocuments, eventCards, payrollRuns, timeEntries };
  }

  private async wipe(tx: Prisma.TransactionClient, hotelId: number) {
    await tx.eventCardMovement.deleteMany({ where: { card: { hotelId } } });
    await tx.eventCardDischarge.deleteMany({ where: { hotelId } });
    await tx.eventCard.deleteMany({ where: { hotelId } });
    await tx.reservation.updateMany({ where: { hotelId }, data: { depositPaymentId: null } });
    await tx.stockMovement.deleteMany({ where: { warehouse: { hotelId } } });
    await tx.receiptLine.deleteMany({ where: { receipt: { hotelId } } });
    await tx.payment.deleteMany({ where: { hotelId } });
    await tx.charge.deleteMany({ where: { hotelId } });
    await tx.invoiceLine.deleteMany({ where: { invoice: { hotelId } } });
    await tx.invoice.updateMany({ where: { hotelId }, data: { creditOfId: null } });
    await tx.invoice.deleteMany({ where: { hotelId } });
    await tx.receipt.deleteMany({ where: { hotelId } });
    await tx.invoiceSeries.updateMany({ where: { hotelId }, data: { nextNumber: 1, lastHash: null } });
    await tx.orderItem.deleteMany({ where: { order: { hotelId } } });
    await tx.order.deleteMany({ where: { hotelId } });
    await tx.cashMovement.deleteMany({ where: { session: { register: { hotelId } } } });
    await tx.cashSession.deleteMany({ where: { register: { hotelId } } });
    await tx.stockDocumentItem.deleteMany({ where: { document: { hotelId } } });
    await tx.stockDocument.deleteMany({ where: { hotelId } });
    await tx.stockDocumentSeries.deleteMany({ where: { hotelId } });
    await tx.stockLot.deleteMany({ where: { warehouse: { hotelId } } });
    await tx.stockLevel.deleteMany({ where: { warehouse: { hotelId } } });
    await tx.purchaseItem.deleteMany({ where: { purchase: { hotelId } } });
    await tx.purchase.deleteMany({ where: { hotelId } });
    await tx.reservationCompanion.deleteMany({ where: { reservation: { hotelId } } });
    await tx.reservation.deleteMany({ where: { hotelId } });
    await tx.reservationGroup.deleteMany({ where: { hotelId } });
    await tx.guest.deleteMany({ where: { hotelId } });
    await tx.payslip.deleteMany({ where: { run: { hotelId } } });
    await tx.payrollRun.deleteMany({ where: { hotelId } });
    await tx.timeEntry.deleteMany({ where: { hotelId } });
    await tx.shift.deleteMany({ where: { hotelId } });
    await tx.room.updateMany({ where: { hotelId }, data: { status: RoomStatus.AVAILABLE } });
  }

  private async hotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('Escolha o hotel');
    return this.prisma.hotel.findUniqueOrThrow({ where: { id: scoped } });
  }
}
