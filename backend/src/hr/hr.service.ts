import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TimeEntrySource, UserRole } from '@prisma/client';
import { localParts } from '../at/at-format';
import { JwtPayload } from '../auth/jwt-payload';
import { addDays, nightsBetween, parseDate } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ClockDto, CopyWeekDto, EmployeeDto, MonthQueryDto, RangeQueryDto, ShiftDto, UpdateEmployeeDto, UpdateShiftDto, UpdateTimeEntryDto } from './hr.dto';

const PUBLIC_FIELDS = {
  id: true,
  hotelId: true,
  userId: true,
  fullName: true,
  jobTitle: true,
  department: true,
  active: true,
} satisfies Prisma.EmployeeSelect;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function shiftMinutes(shift: { startTime: string; endTime: string; breakMinutes: number }) {
  let span = toMinutes(shift.endTime) - toMinutes(shift.startTime);
  if (span <= 0) span += 24 * 60;
  return Math.max(span - shift.breakMinutes, 0);
}

function interval(shift: { startTime: string; endTime: string }) {
  const start = toMinutes(shift.startTime);
  let end = toMinutes(shift.endTime);
  if (end <= start) end += 24 * 60;
  return [start, end] as const;
}

function isManager(user: JwtPayload) {
  return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
}

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  employees(query: HotelQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = [{ active: 'desc' }, { fullName: 'asc' }];
    if (!isManager(user)) {
      return this.prisma.employee.findMany({ where: { hotelId, active: true }, select: PUBLIC_FIELDS, orderBy });
    }
    return this.prisma.employee.findMany({ where: { hotelId }, include: { user: { select: { id: true, email: true } } }, orderBy });
  }

  async createEmployee({ hotelId, startDate, endDate, ...data }: EmployeeDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    await this.assertUserLink(scoped, data.userId);
    return this.prisma.employee.create({
      data: { ...data, hotelId: scoped, startDate: parseDate(startDate), endDate: endDate ? parseDate(endDate) : null },
    });
  }

  async updateEmployee(id: number, { startDate, endDate, ...data }: UpdateEmployeeDto, user: JwtPayload) {
    const employee = await this.findEmployee(id, user);
    await this.assertUserLink(employee.hotelId, data.userId);
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...data,
        ...(startDate ? { startDate: parseDate(startDate) } : {}),
        ...(endDate !== undefined ? { endDate: endDate ? parseDate(endDate) : null } : {}),
      },
    });
  }

  shifts(query: RangeQueryDto, user: JwtPayload) {
    return this.prisma.shift.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        employeeId: query.employeeId,
        date: { gte: parseDate(query.from), lte: parseDate(query.to) },
      },
      include: { employee: { select: { id: true, fullName: true, jobTitle: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }

  async createShift(dto: ShiftDto, user: JwtPayload) {
    const employee = await this.findEmployee(dto.employeeId, user);
    if (!employee.active) {
      throw new BadRequestException('O funcionario esta inativo');
    }
    const date = parseDate(dto.date);
    await this.assertNoOverlap(employee.id, date, dto);
    return this.prisma.shift.create({
      data: { ...dto, hotelId: employee.hotelId, date, breakMinutes: dto.breakMinutes ?? 0 },
      include: { employee: { select: { id: true, fullName: true, jobTitle: true } } },
    });
  }

  async updateShift(id: number, dto: UpdateShiftDto, user: JwtPayload) {
    const shift = await this.findShift(id, user);
    const next = { startTime: dto.startTime ?? shift.startTime, endTime: dto.endTime ?? shift.endTime };
    const date = dto.date ? parseDate(dto.date) : shift.date;
    await this.assertNoOverlap(shift.employeeId, date, next, id);
    return this.prisma.shift.update({
      where: { id },
      data: { ...dto, date },
      include: { employee: { select: { id: true, fullName: true, jobTitle: true } } },
    });
  }

  async removeShift(id: number, user: JwtPayload) {
    await this.findShift(id, user);
    await this.prisma.shift.delete({ where: { id } });
  }

  async copyWeek(dto: CopyWeekDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const from = parseDate(dto.fromWeek);
    const to = parseDate(dto.toWeek);
    const offset = nightsBetween(from, to);
    if (offset % 7 !== 0 || offset === 0) {
      throw new BadRequestException('As semanas de origem e destino tem de comecar no mesmo dia da semana');
    }
    const existing = await this.prisma.shift.count({ where: { hotelId, date: { gte: to, lt: addDays(to, 7) } } });
    if (existing) {
      throw new ConflictException('A semana de destino ja tem turnos: apaga-os antes de copiar');
    }
    const source = await this.prisma.shift.findMany({
      where: { hotelId, date: { gte: from, lt: addDays(from, 7) }, employee: { active: true } },
    });
    await this.prisma.shift.createMany({
      data: source.map(({ id: _id, createdAt: _createdAt, date, ...shift }) => ({ ...shift, date: addDays(date, offset) })),
    });
    return { copied: source.length };
  }

  async clock(dto: ClockDto, user: JwtPayload) {
    const own = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    const employeeId = dto.employeeId ?? own?.id;
    if (!employeeId) {
      throw new BadRequestException('A tua conta nao esta associada a uma ficha de funcionario');
    }
    const forOther = employeeId !== own?.id;
    if (forOther && !isManager(user)) {
      throw new ForbiddenException('So um gestor pode picar por outro funcionario');
    }
    const employee = forOther ? await this.findEmployee(employeeId, user) : own!;
    if (!employee.active) {
      throw new BadRequestException('O funcionario esta inativo');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employee.id} FOR UPDATE`;
      const open = await tx.timeEntry.findFirst({ where: { employeeId: employee.id, clockOut: null }, orderBy: { clockIn: 'desc' } });
      if (open) {
        return tx.timeEntry.update({ where: { id: open.id }, data: { clockOut: new Date(), notes: dto.notes ?? open.notes } });
      }
      return tx.timeEntry.create({
        data: {
          hotelId: employee.hotelId,
          employeeId: employee.id,
          clockIn: new Date(),
          source: forOther ? TimeEntrySource.MANAGER : TimeEntrySource.SELF,
          notes: dto.notes,
        },
      });
    });
  }

  async myStatus(user: JwtPayload) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub }, select: PUBLIC_FIELDS });
    if (!employee) {
      return { employee: null, open: null };
    }
    const open = await this.prisma.timeEntry.findFirst({ where: { employeeId: employee.id, clockOut: null } });
    return { employee, open };
  }

  async timeEntries(query: RangeQueryDto, user: JwtPayload) {
    let employeeId = query.employeeId;
    if (!isManager(user)) {
      const own = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
      if (!own) return [];
      employeeId = own.id;
    }
    return this.prisma.timeEntry.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        employeeId,
        clockIn: { gte: addDays(parseDate(query.from), -1), lt: addDays(parseDate(query.to), 2) },
      },
      include: { employee: { select: { id: true, fullName: true } }, editedBy: { select: { name: true } } },
      orderBy: { clockIn: 'desc' },
    }).then((entries) =>
      entries.filter((entry) => {
        const day = localParts(entry.clockIn).date;
        return day >= query.from && day <= query.to;
      }),
    );
  }

  async updateTimeEntry(id: number, dto: UpdateTimeEntryDto, user: JwtPayload) {
    const entry = await this.prisma.timeEntry.findUnique({ where: { id } });
    if (!entry || !canAccessHotel(user, entry.hotelId)) {
      throw new NotFoundException('Picagem nao encontrada');
    }
    const clockIn = dto.clockIn ? new Date(dto.clockIn) : entry.clockIn;
    const clockOut = dto.clockOut === undefined ? entry.clockOut : dto.clockOut ? new Date(dto.clockOut) : null;
    if (clockOut && clockOut <= clockIn) {
      throw new BadRequestException('A saida tem de ser depois da entrada');
    }
    if (clockOut && clockOut.getTime() - clockIn.getTime() > 24 * 3600 * 1000) {
      throw new BadRequestException('Uma picagem nao pode ter mais de 24 horas');
    }
    return this.prisma.timeEntry.update({
      where: { id },
      data: { clockIn, clockOut, notes: dto.notes, editedById: user.sub, editedAt: new Date() },
    });
  }

  async monthly(query: MonthQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const from = parseDate(`${query.month}-01`);
    const [year, month] = query.month.split('-').map(Number);
    const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    const [employees, shifts, entries] = await Promise.all([
      this.prisma.employee.findMany({ where: { hotelId }, orderBy: { fullName: 'asc' } }),
      this.prisma.shift.findMany({ where: { hotelId, date: { gte: from, lt: to } } }),
      this.prisma.timeEntry.findMany({ where: { hotelId, clockIn: { gte: addDays(from, -1), lt: addDays(to, 1) } } }),
    ]);
    const inMonth = entries.filter((entry) => localParts(entry.clockIn).date.startsWith(query.month));

    return employees
      .map((employee) => {
        const own = shifts.filter((shift) => shift.employeeId === employee.id);
        const worked = inMonth.filter((entry) => entry.employeeId === employee.id);
        const scheduledMinutes = own.reduce((sum, shift) => sum + shiftMinutes(shift), 0);
        const workedMinutes = worked
          .filter((entry) => entry.clockOut)
          .reduce((sum, entry) => sum + Math.round((entry.clockOut!.getTime() - entry.clockIn.getTime()) / 60000), 0);
        return {
          employeeId: employee.id,
          fullName: employee.fullName,
          jobTitle: employee.jobTitle,
          active: employee.active,
          scheduledShifts: own.length,
          scheduledMinutes,
          workedDays: new Set(worked.map((entry) => localParts(entry.clockIn).date)).size,
          workedMinutes,
          differenceMinutes: workedMinutes - scheduledMinutes,
          openEntries: worked.filter((entry) => !entry.clockOut).length,
          editedEntries: worked.filter((entry) => entry.editedAt).length,
        };
      })
      .filter((row) => row.active || row.scheduledShifts || row.workedMinutes);
  }

  private async assertNoOverlap(employeeId: number, date: Date, shift: { startTime: string; endTime: string }, excludeId?: number) {
    const nearby = await this.prisma.shift.findMany({
      where: { employeeId, date: { gte: addDays(date, -1), lte: addDays(date, 1) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    const [start, end] = interval(shift);
    const clash = nearby.find((other) => {
      const offset = nightsBetween(date, other.date) * 24 * 60;
      const [otherStart, otherEnd] = interval(other);
      return start < otherEnd + offset && otherStart + offset < end;
    });
    if (clash) {
      throw new ConflictException(`Sobrepoe-se ao turno ${clash.startTime}-${clash.endTime} desse dia`);
    }
  }

  private async assertUserLink(hotelId: number, userId?: number | null) {
    if (!userId) return;
    const linked = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!linked || (linked.hotelId !== null && linked.hotelId !== hotelId)) {
      throw new BadRequestException('A conta de utilizador tem de pertencer a este hotel');
    }
  }

  private async findEmployee(id: number, user: JwtPayload) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !canAccessHotel(user, employee.hotelId)) {
      throw new NotFoundException('Funcionario nao encontrado');
    }
    return employee;
  }

  private async findShift(id: number, user: JwtPayload) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift || !canAccessHotel(user, shift.hotelId)) {
      throw new NotFoundException('Turno nao encontrado');
    }
    return shift;
  }
}
