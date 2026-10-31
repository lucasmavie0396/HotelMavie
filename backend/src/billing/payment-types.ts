import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { PaymentMethod, Prisma, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PAYMENT_MECHANISM } from '../at/at-format';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';

export const SAFT_MECHANISMS = ['CC', 'CD', 'CH', 'CI', 'CO', 'CS', 'DE', 'LC', 'MB', 'NU', 'OU', 'PR', 'TB', 'TR'] as const;

const DEFAULTS: { name: string; kind: PaymentMethod; requiresReference: boolean }[] = [
  { name: 'Numerario', kind: PaymentMethod.CASH, requiresReference: false },
  { name: 'Cartao', kind: PaymentMethod.CARD, requiresReference: false },
  { name: 'Transferencia', kind: PaymentMethod.TRANSFER, requiresReference: true },
  { name: 'Pagamento movel', kind: PaymentMethod.MOBILE, requiresReference: true },
  { name: 'Outro', kind: PaymentMethod.OTHER, requiresReference: false },
];

export class PaymentTypeDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(60)
  name: string;

  @IsEnum(PaymentMethod)
  kind: PaymentMethod;

  @IsOptional()
  @IsIn(SAFT_MECHANISMS)
  mechanism?: string;

  @IsOptional()
  @IsBoolean()
  requiresReference?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePaymentTypeDto extends PartialType(OmitType(PaymentTypeDto, ['hotelId', 'kind'] as const)) {}

export interface PaymentChoice {
  method?: PaymentMethod;
  paymentTypeId?: number | null;
  reference?: string | null;
}

@Injectable()
export class PaymentTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(hotelId: number) {
    const count = await this.prisma.paymentType.count({ where: { hotelId } });
    if (!count) {
      await this.prisma.paymentType.createMany({
        data: DEFAULTS.map((type, index) => ({ ...type, hotelId, mechanism: PAYMENT_MECHANISM[type.kind], sortOrder: index + 1 })),
        skipDuplicates: true,
      });
    }
  }

  async resolve(tx: Prisma.TransactionClient, hotelId: number, choice: PaymentChoice) {
    if (choice.paymentTypeId) {
      const type = await tx.paymentType.findUnique({ where: { id: choice.paymentTypeId } });
      if (!type || type.hotelId !== hotelId || !type.active) {
        throw new BadRequestException('Tipo de pagamento invalido para este hotel');
      }
      if (type.requiresReference && !choice.reference?.trim()) {
        throw new BadRequestException(`O pagamento por ${type.name} exige referencia`);
      }
      return { method: type.kind, paymentTypeId: type.id, name: type.name };
    }
    if (!choice.method) {
      throw new BadRequestException('Indica o tipo de pagamento');
    }
    const fallback = await tx.paymentType.findFirst({
      where: { hotelId, kind: choice.method, active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { method: choice.method, paymentTypeId: fallback?.id ?? null, name: fallback?.name ?? choice.method };
  }
}

@Controller('payment-types')
export class PaymentTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly types: PaymentTypesService,
  ) {}

  @SalesAccess()
  @Get()
  async list(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (hotelId) await this.types.ensureDefaults(hotelId);
    return this.prisma.paymentType.findMany({ where: { hotelId }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  create(@Body() { hotelId, ...data }: PaymentTypeDto, @CurrentUser() user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.paymentType.create({ data: { ...data, hotelId: scoped, mechanism: data.mechanism ?? PAYMENT_MECHANISM[data.kind] } });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePaymentTypeDto, @CurrentUser() user: JwtPayload) {
    const type = await this.prisma.paymentType.findUnique({ where: { id } });
    if (!type || !canAccessHotel(user, type.hotelId)) {
      throw new NotFoundException('Tipo de pagamento nao encontrado');
    }
    return this.prisma.paymentType.update({ where: { id }, data: dto });
  }
}
