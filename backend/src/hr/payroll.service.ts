import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaperWidth, PayrollStatus, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { Ticket } from '../billing/ticket-pdf.service';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { Report } from '../reports/report-model';
import { ReportRenderService } from '../reports/report-render.service';
import { HrService } from './hr.service';
import { computePayslip, defaultSubsidies, ExtraLine, hourlyRate, PayrollRates } from './payroll-calc';

export class PayrollSettingsDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  employeeSsRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  employerSsRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(3)
  overtimeMultiplier: number;

  @IsBoolean()
  subsidiesInTwelfths: boolean;

  @IsInt()
  @Min(1)
  @Max(12)
  holidayPayMonth: number;

  @IsInt()
  @Min(1)
  @Max(12)
  christmasPayMonth: number;
}

export class CreateRunDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mes no formato AAAA-MM' })
  month: string;
}

export class ExtraLineDto {
  @IsString()
  @MaxLength(60)
  label: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsIn(['EARNING', 'DEDUCTION'])
  kind: 'EARNING' | 'DEDUCTION';

  @IsBoolean()
  taxable: boolean;
}

export class UpdatePayslipDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  absenceHours?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overtimeHours?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  holidayPay?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  christmasPay?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(60)
  irsRate?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExtraLineDto)
  extraLines?: ExtraLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class RunQueryDto extends HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DEFAULTS: PayrollRates = { employeeSsRate: 11, employerSsRate: 23.75, overtimeMultiplier: 1.25, subsidiesInTwelfths: false, holidayPayMonth: 6, christmasPayMonth: 12 };

const runInclude = {
  payslips: { orderBy: { fullName: 'asc' } },
  createdBy: { select: { name: true } },
} satisfies Prisma.PayrollRunInclude;

type Slip = Prisma.PayslipGetPayload<object>;

export function periodLabel(run: { year: number; month: number }) {
  return `${MONTHS[run.month - 1]} ${run.year}`;
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hr: HrService,
    private readonly render: ReportRenderService,
    private readonly audit: AuditService,
  ) {}

  async settings(query: HotelQueryDto, user: JwtPayload) {
    const hotelId = this.hotelOf(user, query.hotelId);
    const stored = await this.prisma.payrollSettings.findUnique({ where: { hotelId } });
    return stored ?? { hotelId, ...DEFAULTS };
  }

  async saveSettings({ hotelId, ...data }: PayrollSettingsDto, user: JwtPayload) {
    const scoped = this.hotelOf(user, hotelId);
    return this.prisma.payrollSettings.upsert({ where: { hotelId: scoped }, create: { ...data, hotelId: scoped }, update: data });
  }

  runs(query: RunQueryDto, user: JwtPayload) {
    return this.prisma.payrollRun.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), year: query.year },
      include: { payslips: { select: { grossPay: true, netPay: true, employerSs: true } }, createdBy: { select: { name: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findRun(id: number, user: JwtPayload) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: runInclude });
    if (!run || !canAccessHotel(user, run.hotelId)) {
      throw new NotFoundException('Processamento nao encontrado');
    }
    return run;
  }

  async createRun(dto: CreateRunDto, user: JwtPayload) {
    const hotelId = this.hotelOf(user, dto.hotelId);
    const [year, month] = dto.month.split('-').map(Number);
    const run = await this.prisma.payrollRun.create({ data: { hotelId, year, month, createdById: user.sub } });
    await this.fill(run.id, user, true);
    return this.findRun(run.id, user);
  }

  async recalculate(id: number, user: JwtPayload) {
    const run = await this.findRun(id, user);
    this.assertDraft(run);
    await this.fill(id, user, false);
    return this.findRun(id, user);
  }

  async updatePayslip(id: number, dto: UpdatePayslipDto, user: JwtPayload) {
    const slip = await this.prisma.payslip.findUnique({ where: { id }, include: { run: true, employee: true } });
    if (!slip || !canAccessHotel(user, slip.run.hotelId)) {
      throw new NotFoundException('Recibo nao encontrado');
    }
    this.assertDraft(slip.run);
    const rates = await this.rates(slip.run.hotelId);
    const lines = dto.extraLines ?? this.lines(slip);
    const values = computePayslip(
      {
        year: slip.run.year,
        month: slip.run.month,
        baseSalary: slip.baseSalary,
        weeklyHours: slip.weeklyHours,
        irsRate: dto.irsRate ?? slip.irsRate,
        startDate: slip.employee.startDate,
        absenceHours: dto.absenceHours ?? slip.absenceHours,
        overtimeHours: dto.overtimeHours ?? slip.overtimeHours,
        holidayPay: dto.holidayPay ?? slip.holidayPay,
        christmasPay: dto.christmasPay ?? slip.christmasPay,
        extraLines: lines,
      },
      { ...rates, employeeSsRate: slip.employeeSsRate, employerSsRate: slip.employerSsRate },
    );
    return this.prisma.payslip.update({
      where: { id },
      data: { ...values, extraLines: lines as unknown as Prisma.InputJsonValue, notes: dto.notes ?? slip.notes, manual: true },
    });
  }

  async close(id: number, user: JwtPayload) {
    const run = await this.findRun(id, user);
    this.assertDraft(run);
    if (!run.payslips.length) {
      throw new BadRequestException('O processamento nao tem recibos');
    }
    const { count } = await this.prisma.payrollRun.updateMany({ where: { id, status: PayrollStatus.DRAFT }, data: { status: PayrollStatus.CLOSED, closedAt: new Date() } });
    if (!count) {
      throw new ConflictException('Este processamento ja foi fechado');
    }
    await this.audit.log({
      hotelId: run.hotelId,
      userId: user.sub,
      action: 'PAYROLL_CLOSE',
      entity: 'payroll_run',
      entityId: id,
      summary: `Salarios de ${periodLabel(run)} fechados: ${run.payslips.length} recibo(s), liquido ${sumMoney(run.payslips.map((slip) => slip.netPay)).toFixed(2)}`,
    });
    return this.findRun(id, user);
  }

  async remove(id: number, user: JwtPayload) {
    const run = await this.findRun(id, user);
    this.assertDraft(run);
    await this.prisma.payrollRun.delete({ where: { id } });
  }

  async payslipPdf(id: number, user: JwtPayload) {
    const slip = await this.prisma.payslip.findUnique({ where: { id }, include: { run: true } });
    if (!slip || !canAccessHotel(user, slip.run.hotelId)) {
      throw new NotFoundException('Recibo nao encontrado');
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: slip.run.hotelId } });
    const operator = (await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } }))?.name ?? '-';
    const money = (value: Prisma.Decimal.Value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const hours = (value: Prisma.Decimal.Value) => `${Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} h`;
    const pct = (value: Prisma.Decimal.Value) => `${Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}%`;
    const lines = this.lines(slip);
    const earnings: string[][] = [['Vencimento base', '', money(slip.baseSalary)]];
    if (slip.overtimePay.greaterThan(0)) earnings.push([`Trabalho suplementar`, hours(slip.overtimeHours), money(slip.overtimePay)]);
    if (slip.holidayPay.greaterThan(0)) earnings.push(['Subsidio de ferias', '', money(slip.holidayPay)]);
    if (slip.christmasPay.greaterThan(0)) earnings.push(['Subsidio de Natal', '', money(slip.christmasPay)]);
    for (const line of lines.filter((item) => item.kind === 'EARNING')) earnings.push([`${line.label}${line.taxable ? '' : ' (isento)'}`, '', money(line.amount)]);
    const deductions: string[][] = [];
    if (slip.absenceDeduction.greaterThan(0)) deductions.push(['Faltas', hours(slip.absenceHours), money(slip.absenceDeduction)]);
    deductions.push([`Seguranca Social (${pct(slip.employeeSsRate)})`, money(slip.ssBase), money(slip.employeeSs)]);
    deductions.push([`Retencao IRS (${pct(slip.irsRate)})`, money(slip.ssBase), money(slip.irsWithholding)]);
    for (const line of lines.filter((item) => item.kind === 'DEDUCTION')) deductions.push([line.label, '', money(line.amount)]);
    const deductionTotal = slip.absenceDeduction.add(slip.employeeSs).add(slip.irsWithholding).add(slip.otherDeductions);
    const columns = [
      { label: 'Descricao', weight: 2.6 },
      { label: 'Quantidade / base', align: 'right' as const, weight: 1.2 },
      { label: 'Valor', align: 'right' as const, weight: 1 },
    ];
    const report: Report = {
      key: 'payslip',
      title: `Recibo de vencimento`,
      period: periodLabel(slip.run),
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator,
      hotel,
      sections: [
        {
          title: 'Trabalhador',
          kpis: [
            { label: 'Nome', value: slip.fullName },
            { label: 'Funcao', value: slip.jobTitle },
            { label: 'NIF', value: slip.taxId ?? '-' },
            { label: 'N.o Seg. Social', value: slip.socialSecurityNumber ?? '-' },
          ],
        },
        {
          title: 'Abonos',
          table: { columns, rows: earnings, totals: ['Total iliquido', '', money(slip.grossPay.add(slip.absenceDeduction))] },
        },
        {
          title: 'Descontos',
          table: { columns, rows: deductions, totals: ['Total de descontos', '', money(deductionTotal)] },
        },
        {
          title: 'Liquido a receber',
          kpis: [
            { label: 'Liquido', value: money(slip.netPay) },
            { label: 'Valor hora', value: money(slip.hourlyRate) },
            { label: 'Horas semanais', value: hours(slip.weeklyHours) },
          ],
          note: [
            slip.iban ? `Pagamento por transferencia para o IBAN ${slip.iban}.` : null,
            `Encargo da entidade patronal para a Seguranca Social: ${money(slip.employerSs)} (${pct(slip.employerSsRate)}).`,
            'Taxa de retencao de IRS definida pela entidade patronal de acordo com as tabelas em vigor.',
            slip.notes,
          ]
            .filter(Boolean)
            .join(' '),
        },
        { title: 'Recebi', note: 'Assinatura do trabalhador: ______________________________    Data: ____/____/______' },
      ],
    };
    return { buffer: await this.render.pdf(report, PaperWidth.A4), name: `recibo-${slip.run.year}-${String(slip.run.month).padStart(2, '0')}-${slip.employeeId}` };
  }

  async summaryPdf(id: number, user: JwtPayload) {
    const run = await this.findRun(id, user);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: run.hotelId } });
    const operator = (await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } }))?.name ?? '-';
    const money = (value: Prisma.Decimal.Value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const total = (key: 'grossPay' | 'employeeSs' | 'irsWithholding' | 'netPay' | 'employerSs') => money(sumMoney(run.payslips.map((slip) => slip[key])));
    const report: Report = {
      key: 'payroll',
      title: 'Mapa de salarios',
      period: `${periodLabel(run)} · ${run.status === PayrollStatus.CLOSED ? 'fechado' : 'rascunho'}`,
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator,
      hotel,
      sections: [
        {
          title: 'Resumo',
          kpis: [
            { label: 'Recibos', value: String(run.payslips.length) },
            { label: 'Bruto', value: total('grossPay') },
            { label: 'Liquido', value: total('netPay') },
            { label: 'Encargos SS empresa', value: total('employerSs') },
          ],
        },
        {
          title: 'Recibos',
          table: {
            columns: [
              { label: 'Trabalhador', weight: 2.2 },
              { label: 'Bruto', align: 'right', weight: 1 },
              { label: 'SS trab.', align: 'right', weight: 0.9 },
              { label: 'IRS', align: 'right', weight: 0.9 },
              { label: 'Liquido', align: 'right', weight: 1 },
              { label: 'SS empresa', align: 'right', weight: 1 },
            ],
            rows: run.payslips.map((slip) => [slip.fullName, money(slip.grossPay), money(slip.employeeSs), money(slip.irsWithholding), money(slip.netPay), money(slip.employerSs)]),
            totals: ['Total', total('grossPay'), total('employeeSs'), total('irsWithholding'), total('netPay'), total('employerSs')],
          },
          note: 'A Seguranca Social a entregar e a soma das contribuicoes do trabalhador e da empresa; o IRS retido e entregue na declaracao mensal de remuneracoes.',
        },
      ],
    };
    return this.render.pdf(report, PaperWidth.A4);
  }

  private async fill(runId: number, user: JwtPayload, fresh: boolean) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: true } });
    const month = `${run.year}-${String(run.month).padStart(2, '0')}`;
    const [rates, employees, hours] = await Promise.all([
      this.rates(run.hotelId),
      this.prisma.employee.findMany({ where: { hotelId: run.hotelId, active: true, baseSalary: { gt: 0 } } }),
      this.hr.monthly({ hotelId: run.hotelId, month }, user),
    ]);
    const monthEnd = new Date(Date.UTC(run.year, run.month, 0));
    const eligible = employees.filter((employee) => employee.startDate <= monthEnd);
    for (const employee of eligible) {
      const existing = run.payslips.find((slip) => slip.employeeId === employee.id);
      if (!fresh && existing?.manual) continue;
      const time = hours.find((row) => row.employeeId === employee.id);
      const scheduled = (time?.scheduledMinutes ?? 0) / 60;
      const worked = (time?.workedMinutes ?? 0) / 60;
      const absenceHours = scheduled > 0 ? Math.max(scheduled - worked, 0) : 0;
      const overtimeHours = scheduled > 0 ? Math.max(worked - scheduled, 0) : 0;
      const subsidies = defaultSubsidies({ year: run.year, month: run.month, baseSalary: employee.baseSalary!, startDate: employee.startDate }, rates);
      const values = computePayslip(
        {
          year: run.year,
          month: run.month,
          baseSalary: employee.baseSalary!,
          weeklyHours: employee.weeklyHours,
          irsRate: employee.irsRate,
          startDate: employee.startDate,
          absenceHours,
          overtimeHours,
          holidayPay: subsidies.holidayPay,
          christmasPay: subsidies.christmasPay,
          extraLines: existing ? this.lines(existing) : [],
        },
        rates,
      );
      const data = {
        fullName: employee.fullName,
        jobTitle: employee.jobTitle,
        taxId: employee.taxId,
        socialSecurityNumber: employee.socialSecurityNumber,
        iban: employee.iban,
        weeklyHours: employee.weeklyHours,
        scheduledHours: new Prisma.Decimal(scheduled).toDecimalPlaces(2),
        workedHours: new Prisma.Decimal(worked).toDecimalPlaces(2),
        ...values,
        hourlyRate: hourlyRate(values.baseSalary, employee.weeklyHours),
      };
      if (existing) {
        await this.prisma.payslip.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.payslip.create({ data: { ...data, runId, employeeId: employee.id } });
      }
    }
  }

  private lines(slip: Pick<Slip, 'extraLines'>): ExtraLine[] {
    return Array.isArray(slip.extraLines) ? (slip.extraLines as unknown as ExtraLine[]) : [];
  }

  private async rates(hotelId: number): Promise<PayrollRates> {
    const stored = await this.prisma.payrollSettings.findUnique({ where: { hotelId } });
    return stored ?? DEFAULTS;
  }

  private assertDraft(run: { status: PayrollStatus }) {
    if (run.status !== PayrollStatus.DRAFT) {
      throw new ConflictException('O processamento esta fechado e ja nao pode ser alterado');
    }
  }

  private hotelOf(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return scoped;
  }
}
