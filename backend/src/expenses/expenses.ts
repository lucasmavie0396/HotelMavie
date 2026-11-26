import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CashMovementType, ExpenseStatus, PaymentMethod, Prisma, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { localParts } from '../at/at-format';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { requireOpenCash } from '../billing/cash-guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { isManagerRole, Roles } from '../common/decorators/roles.decorator';
import { addDays, parseDate } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export class ExpenseCategoryDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ExpenseDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsInt()
  categoryId: number;

  @IsString()
  @Length(3, 200)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount: number;

  @IsDateString({ strict: true })
  @Length(10, 10)
  date: string;

  @IsOptional()
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentRef?: string;

  @IsOptional()
  @IsInt()
  paymentTypeId?: number;
}

export class ExpenseQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;
}

export class VoidExpenseDto {
  @IsString()
  @Length(3, 200)
  reason: string;
}

const include = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  paymentType: { select: { id: true, name: true, kind: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  categories(query: HotelQueryDto, user: JwtPayload) {
    return this.prisma.expenseCategory.findMany({ where: { hotelId: resolveHotelScope(user, query.hotelId) }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  createCategory(dto: ExpenseCategoryDto, user: JwtPayload) {
    return this.prisma.expenseCategory.create({ data: { hotelId: this.hotel(user, dto.hotelId), name: dto.name.trim(), active: dto.active ?? true } });
  }

  async updateCategory(id: number, dto: ExpenseCategoryDto, user: JwtPayload) {
    const category = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!category || !canAccessHotel(user, category.hotelId)) throw new NotFoundException('Categoria nao encontrada');
    return this.prisma.expenseCategory.update({ where: { id }, data: { name: dto.name.trim(), active: dto.active } });
  }

  list(query: ExpenseQueryDto, user: JwtPayload) {
    return this.prisma.expense.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        categoryId: query.categoryId,
        status: query.status,
        date: { gte: query.from ? parseDate(query.from) : undefined, lt: query.to ? addDays(parseDate(query.to), 1) : undefined },
      },
      include,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 1000,
    });
  }

  async create(dto: ExpenseDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const category = await this.prisma.expenseCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || category.hotelId !== hotelId || !category.active) throw new BadRequestException('Categoria de despesa invalida');
    if (dto.date > localParts(new Date()).date) throw new BadRequestException('A data da despesa nao pode ser futura');
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier || supplier.hotelId !== hotelId) throw new BadRequestException('Fornecedor invalido para este hotel');
    }
    const paymentType = dto.paymentTypeId ? await this.prisma.paymentType.findUnique({ where: { id: dto.paymentTypeId } }) : null;
    if (dto.paymentTypeId && (!paymentType || paymentType.hotelId !== hotelId || !paymentType.active || paymentType.isEventCard)) {
      throw new BadRequestException('Tipo de pagamento invalido para a despesa');
    }
    const amount = toMoney(dto.amount);
    return this.prisma.$transaction(async (tx) => {
      let cashSessionId: number | null = null;
      let cashMovementId: number | null = null;
      if (paymentType?.kind === PaymentMethod.CASH) {
        const session = await requireOpenCash(tx, hotelId, user.sub);
        const movement = await tx.cashMovement.create({
          data: { sessionId: session.id, type: CashMovementType.OUT, amount, description: `Despesa: ${dto.description.trim()}`.slice(0, 200), createdById: user.sub },
        });
        cashSessionId = session.id;
        cashMovementId = movement.id;
      }
      const expense = await tx.expense.create({
        data: {
          hotelId,
          categoryId: category.id,
          description: dto.description.trim(),
          amount,
          date: parseDate(dto.date),
          supplierId: dto.supplierId ?? null,
          documentRef: dto.documentRef?.trim() || null,
          paymentTypeId: paymentType?.id ?? null,
          cashSessionId,
          cashMovementId,
          createdById: user.sub,
        },
        include,
      });
      await this.audit.log(
        { hotelId, userId: user.sub, action: 'EXPENSE_CREATE', entity: 'expense', entityId: expense.id, summary: `Despesa ${category.name}: ${dto.description.trim()} (${amount.toFixed(2)})${cashSessionId ? ' paga pelo caixa' : ''}` },
        tx,
      );
      return expense;
    });
  }

  async void(id: number, reason: string, user: JwtPayload) {
    if (!isManagerRole(user.role)) throw new ForbiddenException('So um gestor pode anular despesas');
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense || !canAccessHotel(user, expense.hotelId)) throw new NotFoundException('Despesa nao encontrada');
    if (expense.status === ExpenseStatus.VOIDED) throw new BadRequestException('A despesa ja esta anulada');
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.expense.updateMany({
        where: { id, status: ExpenseStatus.CONFIRMED },
        data: { status: ExpenseStatus.VOIDED, voidReason: reason.trim(), voidedAt: new Date(), voidedById: user.sub },
      });
      if (!count) throw new BadRequestException('A despesa ja esta anulada');
      if (expense.cashMovementId) {
        const session = await requireOpenCash(tx, expense.hotelId, user.sub);
        await tx.cashMovement.create({
          data: { sessionId: session.id, type: CashMovementType.IN, amount: expense.amount, description: `Anulacao da despesa #${id}: ${reason.trim()}`.slice(0, 200), createdById: user.sub },
        });
      }
      await this.audit.log(
        { hotelId: expense.hotelId, userId: user.sub, action: 'EXPENSE_VOID', entity: 'expense', entityId: id, summary: `Despesa #${id} anulada (${expense.amount.toFixed(2)}): ${reason.trim()}` },
        tx,
      );
      return tx.expense.findUniqueOrThrow({ where: { id }, include });
    });
  }

  private hotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('hotelId e obrigatorio');
    return scoped;
  }
}

@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expense-categories')
  categories(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.categories(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('expense-categories')
  createCategory(@Body() dto: ExpenseCategoryDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.createCategory(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('expense-categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: ExpenseCategoryDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.updateCategory(id, dto, user);
  }

  @Get('expenses')
  list(@Query() query: ExpenseQueryDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.list(query, user);
  }

  @Post('expenses')
  create(@Body() dto: ExpenseDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.create(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('expenses/:id/void')
  @HttpCode(HttpStatus.OK)
  void(@Param('id', ParseIntPipe) id: number, @Body() dto: VoidExpenseDto, @CurrentUser() user: JwtPayload) {
    return this.expenses.void(id, dto.reason, user);
  }
}
