import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeType, InvoiceStatus, InvoiceType, PaymentMethod, Prisma, Reservation } from '@prisma/client';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { isManagerRole } from '../common/decorators/roles.decorator';
import { canAccessHotel } from '../common/hotel-scope';
import { DecimalLike, sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChargeDto, CreatePaymentDto } from './billing.dto';
import { requireOpenCash } from './cash-guard';
import { PaymentTypesService } from './payment-types';

export interface ChargeInput {
  hotelId: number;
  reservationId?: number | null;
  type: ChargeType;
  description: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  taxRateId?: number | null;
  sourceRef?: string;
  productCode?: string;
  createdById?: number;
}

export interface PaymentInput {
  hotelId: number;
  reservationId?: number | null;
  invoiceId?: number | null;
  amount: DecimalLike;
  method?: PaymentMethod;
  paymentTypeId?: number | null;
  cashSessionId?: number | null;
  reference?: string;
  notes?: string;
  createdById?: number;
}

const ACCOMMODATION_REF = 'accommodation';

const ON_GUEST_ACCOUNT: Prisma.ChargeWhereInput = {
  OR: [{ invoiceId: null }, { invoice: { OR: [{ type: { not: InvoiceType.INVOICE } }, { status: { not: InvoiceStatus.ISSUED } }] } }],
};

@Injectable()
export class FolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentTypes: PaymentTypesService,
    private readonly audit: AuditService,
  ) {}

  async getFolio(reservationId: number, user: JwtPayload) {
    const reservation = await this.findReservation(reservationId, user);
    const [charges, payments, invoices] = await Promise.all([
      this.prisma.charge.findMany({
        where: { reservationId },
        include: { invoice: { select: { id: true, fullNumber: true, type: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({ where: { reservationId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.invoice.findMany({
        where: { reservationId },
        select: { id: true, fullNumber: true, type: true, status: true, grossTotal: true, issuedAt: true },
        orderBy: { issuedAt: 'asc' },
      }),
    ]);
    const onAccount = (charge: (typeof charges)[number]) =>
      charge.invoice?.type === InvoiceType.INVOICE && charge.invoice.status === InvoiceStatus.ISSUED;
    const chargesTotal = sumMoney(charges.filter((charge) => !onAccount(charge)).map((charge) => charge.total));
    const paymentsTotal = sumMoney(payments.map((payment) => payment.amount));
    return {
      reservationId: reservation.id,
      charges: charges.map((charge) => ({ ...charge, onCustomerAccount: onAccount(charge) })),
      payments,
      invoices,
      chargesTotal,
      paymentsTotal,
      customerAccountTotal: sumMoney(charges.filter(onAccount).map((charge) => charge.total)),
      balance: chargesTotal.sub(paymentsTotal),
      pendingAccommodation: toMoney(reservation.totalAmount).sub(
        sumMoney(charges.filter((charge) => charge.type === ChargeType.ACCOMMODATION).map((charge) => charge.total)),
      ),
    };
  }

  async addCharge(reservationId: number, dto: CreateChargeDto, user: JwtPayload) {
    const reservation = await this.findReservation(reservationId, user);
    return this.createCharge(this.prisma, {
      hotelId: reservation.hotelId,
      reservationId,
      type: dto.type ?? ChargeType.EXTRA,
      description: dto.description,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      taxRateId: dto.taxRateId,
      createdById: user.sub,
    });
  }

  async removeCharge(chargeId: number, user: JwtPayload) {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge || !canAccessHotel(user, charge.hotelId)) {
      throw new NotFoundException('Lancamento nao encontrado');
    }
    if (charge.invoiceId) {
      throw new ConflictException('Lancamento ja faturado: emite uma nota de credito');
    }
    await this.prisma.charge.delete({ where: { id: chargeId } });
  }

  async addPayment(reservationId: number, dto: CreatePaymentDto, user: JwtPayload) {
    const reservation = await this.findReservation(reservationId, user);
    return this.recordPayment(this.prisma, {
      hotelId: reservation.hotelId,
      reservationId,
      amount: dto.amount,
      method: dto.method,
      paymentTypeId: dto.paymentTypeId,
      cashSessionId: dto.cashSessionId,
      reference: dto.reference,
      notes: dto.notes,
      createdById: user.sub,
    }, user);
  }

  async createCharge(tx: Prisma.TransactionClient, input: ChargeInput) {
    let rate = new Prisma.Decimal(0);
    if (input.taxRateId) {
      const taxRate = await tx.taxRate.findUnique({ where: { id: input.taxRateId } });
      if (!taxRate || taxRate.hotelId !== input.hotelId || !taxRate.active) {
        throw new BadRequestException('Taxa de IVA invalida para este hotel');
      }
      rate = taxRate.rate;
    }
    const quantity = new Prisma.Decimal(input.quantity);
    const unitPrice = toMoney(input.unitPrice);
    return tx.charge.create({
      data: {
        hotelId: input.hotelId,
        reservationId: input.reservationId ?? null,
        type: input.type,
        description: input.description,
        quantity,
        unitPrice,
        taxRateId: input.taxRateId ?? null,
        taxRate: rate,
        total: toMoney(quantity.mul(unitPrice)),
        sourceRef: input.sourceRef,
        productCode: input.productCode ?? (input.type === ChargeType.ACCOMMODATION ? 'ALOJ' : 'EXTRA'),
        createdById: input.createdById,
      },
    });
  }

  async recordPayment(tx: Prisma.TransactionClient, input: PaymentInput, user: JwtPayload) {
    const amount = toMoney(input.amount);
    if (amount.isNegative() && !isManagerRole(user.role)) {
      throw new ForbiddenException('Devolucoes so podem ser feitas por um gestor');
    }
    const type = await this.paymentTypes.resolve(tx, input.hotelId, {
      method: input.method,
      paymentTypeId: input.paymentTypeId,
      reference: amount.isNegative() ? 'estorno' : input.reference,
    });
    const own = await requireOpenCash(tx, input.hotelId, user.sub);
    let cashSessionId: number | null = null;
    if (type.method === PaymentMethod.CASH && input.cashSessionId) {
      const session = await tx.cashSession.findUnique({
        where: { id: input.cashSessionId },
        include: { register: { select: { hotelId: true } } },
      });
      if (!session || session.closedAt || session.register.hotelId !== input.hotelId) {
        throw new ConflictException('A caixa indicada nao esta aberta');
      }
      cashSessionId = session.id;
    } else if (type.method === PaymentMethod.CASH) {
      cashSessionId = own.id;
    }
    const payment = await tx.payment.create({
      data: {
        hotelId: input.hotelId,
        reservationId: input.reservationId ?? null,
        invoiceId: input.invoiceId ?? null,
        amount,
        method: type.method,
        paymentTypeId: type.paymentTypeId,
        cashSessionId,
        reference: input.reference,
        notes: input.notes,
        createdById: input.createdById,
      },
    });
    if (amount.isNegative()) {
      await this.audit.log(
        {
          hotelId: input.hotelId,
          userId: user.sub,
          action: 'PAYMENT_REFUND',
          entity: 'payment',
          entityId: payment.id,
          summary: `Estorno de ${amount.neg().toFixed(2)}${input.notes ? ` (${input.notes})` : ''}${input.reservationId ? ` na reserva #${input.reservationId}` : ''}`,
          data: { amount: amount.toFixed(2), reservationId: input.reservationId ?? null, notes: input.notes ?? null },
        },
        tx,
      );
    }
    return payment;
  }

  async syncAccommodationCharge(tx: Prisma.TransactionClient, reservation: Reservation, createdById?: number) {
    const hotel = await tx.hotel.findUniqueOrThrow({ where: { id: reservation.hotelId } });
    const existing = await tx.charge.findMany({
      where: { reservationId: reservation.id, type: ChargeType.ACCOMMODATION, sourceRef: ACCOMMODATION_REF },
    });
    const difference = toMoney(reservation.totalAmount).sub(sumMoney(existing.map((charge) => charge.total)));
    if (difference.isZero()) {
      return;
    }
    const open = existing.find((charge) => !charge.invoiceId);
    const nights = Math.round((reservation.checkOut.getTime() - reservation.checkIn.getTime()) / 86_400_000);
    if (open) {
      const total = toMoney(open.total).add(difference);
      await tx.charge.update({ where: { id: open.id }, data: { quantity: 1, unitPrice: total, total } });
      return;
    }
    await this.createCharge(tx, {
      hotelId: reservation.hotelId,
      reservationId: reservation.id,
      type: ChargeType.ACCOMMODATION,
      description: existing.length ? 'Ajuste de alojamento' : `Alojamento ${nights} ${nights === 1 ? 'noite' : 'noites'}`,
      quantity: existing.length ? 1 : nights,
      unitPrice: existing.length ? difference : reservation.pricePerNight,
      taxRateId: hotel.accommodationTaxRateId,
      sourceRef: ACCOMMODATION_REF,
      createdById,
    });
  }

  async balance(tx: Prisma.TransactionClient, reservationId: number) {
    const [charges, payments] = await Promise.all([
      tx.charge.aggregate({ where: { reservationId, ...ON_GUEST_ACCOUNT }, _sum: { total: true } }),
      tx.payment.aggregate({ where: { reservationId }, _sum: { amount: true } }),
    ]);
    return toMoney(charges._sum.total ?? 0).sub(toMoney(payments._sum.amount ?? 0));
  }

  private async findReservation(id: number, user: JwtPayload) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation || !canAccessHotel(user, reservation.hotelId)) {
      throw new NotFoundException('Reserva nao encontrada');
    }
    return reservation;
  }
}
