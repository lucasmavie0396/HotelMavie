import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { addDays, parseDate } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  hotelId?: number | null;
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  summary: string;
  data?: Prisma.InputJsonValue;
}

export class AuditQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;
}

export const AUDIT_ACTIONS: Record<string, string> = {
  PRODUCT_PRICE: 'Preco ou custo de produto alterado',
  ORDER_ITEM_VOID: 'Linha de pedido anulada',
  ORDER_CANCEL: 'Pedido anulado',
  PAYMENT_REFUND: 'Estorno de pagamento',
  CREDIT_NOTE: 'Nota de credito emitida',
  RECEIPT_CANCEL: 'Recibo anulado',
  STOCK_DOCUMENT: 'Documento de stock lancado',
  PAYROLL_CLOSE: 'Salarios fechados',
  USER_CHANGE: 'Utilizador alterado',
  USER_2FA_RESET: '2FA desativado por um administrador',
  AUTH_2FA_ENABLED: '2FA ativado',
  AUTH_2FA_DISABLED: '2FA desativado',
  AUTH_PASSWORD_RESET: 'Password reposta por email',
  AUTH_LOGIN_FAILED: 'Tentativa de entrada falhada',
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          hotelId: entry.hotelId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          summary: entry.summary.slice(0, 255),
          data: entry.data,
        },
      });
    } catch (error) {
      if (tx) throw error;
      this.logger.error(`Falha a registar auditoria ${entry.action}: ${error}`);
    }
  }
}

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('actions')
  actions() {
    return AUDIT_ACTIONS;
  }

  @Get()
  list(@Query() query: AuditQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const scope: Prisma.AuditLogWhereInput =
      user.role === UserRole.ADMIN ? (hotelId ? { OR: [{ hotelId }, { hotelId: null }] } : {}) : { hotelId };
    return this.prisma.auditLog.findMany({
      where: {
        ...scope,
        action: query.action,
        userId: query.userId,
        createdAt: {
          gte: query.from ? parseDate(query.from) : undefined,
          lt: query.to ? addDays(parseDate(query.to), 1) : undefined,
        },
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
