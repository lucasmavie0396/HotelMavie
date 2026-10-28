import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomQueryDto } from './dto/room-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: RoomQueryDto, user: JwtPayload) {
    return this.prisma.room.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), status: query.status },
      orderBy: [{ hotelId: 'asc' }, { number: 'asc' }],
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room || !canAccessHotel(user, room.hotelId)) {
      throw new NotFoundException('Quarto nao encontrado');
    }
    return room;
  }

  create(dto: CreateRoomDto, user: JwtPayload) {
    resolveHotelScope(user, dto.hotelId);
    return this.prisma.room.create({ data: dto });
  }

  async update(id: number, dto: UpdateRoomDto, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.room.update({ where: { id }, data: dto });
  }

  async remove(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    await this.prisma.room.delete({ where: { id } });
  }
}
