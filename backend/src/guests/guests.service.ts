import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { parseDate } from '../common/dates';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { GuestQueryDto } from './dto/guest-query.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: GuestQueryDto, user: JwtPayload) {
    const q = query.q?.trim();
    const where: Prisma.GuestWhereInput = {
      hotelId: resolveHotelScope(user, query.hotelId),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
              { documentNumber: { contains: q } },
            ],
          }
        : {}),
    };
    return this.prisma.guest.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 100 });
  }

  async findOne(id: number, user: JwtPayload) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: {
        reservations: {
          orderBy: { checkIn: 'desc' },
          take: 20,
          include: { room: { select: { id: true, number: true, type: true } } },
        },
      },
    });
    if (!guest || !canAccessHotel(user, guest.hotelId)) {
      throw new NotFoundException('Hospede nao encontrado');
    }
    return guest;
  }

  create({ hotelId, birthDate, ...data }: CreateGuestDto, user: JwtPayload) {
    const scopedHotelId = resolveHotelScope(user, hotelId);
    if (!scopedHotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.guest.create({
      data: { ...data, hotelId: scopedHotelId, birthDate: birthDate ? parseDate(birthDate) : undefined },
    });
  }

  async update(id: number, { birthDate, ...data }: UpdateGuestDto, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.guest.update({
      where: { id },
      data: { ...data, ...(birthDate !== undefined ? { birthDate: birthDate ? parseDate(birthDate) : null } : {}) },
    });
  }

  async remove(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    await this.prisma.guest.delete({ where: { id } });
  }
}
