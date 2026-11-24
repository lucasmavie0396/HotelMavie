import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isManagerRole } from '../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomQueryDto } from './dto/room-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

export const MAX_ROOM_IMAGES = 8;
const images = { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }], select: { id: true, file: true, sortOrder: true } };
const taxRate = { select: { id: true, name: true, rate: true } };

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  findAll(query: RoomQueryDto, user: JwtPayload) {
    return this.prisma.room.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), status: query.status },
      include: { images, taxRate },
      orderBy: [{ hotelId: 'asc' }, { number: 'asc' }],
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const room = await this.prisma.room.findUnique({ where: { id }, include: { images, taxRate } });
    if (!room || !canAccessHotel(user, room.hotelId)) {
      throw new NotFoundException('Quarto nao encontrado');
    }
    return room;
  }

  async create(dto: CreateRoomDto, user: JwtPayload) {
    resolveHotelScope(user, dto.hotelId);
    await this.checkTaxRate(dto.hotelId, dto.taxRateId);
    return this.prisma.room.create({ data: dto, include: { images, taxRate } });
  }

  async update(id: number, dto: UpdateRoomDto, user: JwtPayload) {
    const room = await this.findOne(id, user);
    const { status: _status, ...details } = dto;
    if (Object.values(details).some((value) => value !== undefined) && !isManagerRole(user.role)) {
      throw new ForbiddenException('So gestores podem alterar os dados do quarto');
    }
    await this.checkTaxRate(room.hotelId, dto.taxRateId);
    return this.prisma.room.update({ where: { id }, data: dto, include: { images, taxRate } });
  }

  private async checkTaxRate(hotelId: number, taxRateId: number | null | undefined) {
    if (!taxRateId) return;
    const rate = await this.prisma.taxRate.findUnique({ where: { id: taxRateId } });
    if (!rate || rate.hotelId !== hotelId || !rate.active) {
      throw new BadRequestException('Taxa de IVA invalida para este hotel');
    }
  }

  async remove(id: number, user: JwtPayload) {
    const room = await this.findOne(id, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { roomId: id }, data: { roomId: null } });
      await tx.room.delete({ where: { id } });
    });
    for (const image of room.images) await this.uploads.remove(image.file);
  }

  async addImage(id: number, data: string, user: JwtPayload) {
    const room = await this.findOne(id, user);
    if (room.images.length >= MAX_ROOM_IMAGES) {
      throw new BadRequestException(`Cada quarto pode ter ate ${MAX_ROOM_IMAGES} fotografias`);
    }
    const file = await this.uploads.saveImage(data);
    const sortOrder = room.images.reduce((max, image) => Math.max(max, image.sortOrder + 1), 0);
    await this.prisma.roomImage.create({ data: { roomId: id, file, sortOrder } });
    return this.findOne(id, user);
  }

  async removeImage(id: number, imageId: number, user: JwtPayload) {
    const room = await this.findOne(id, user);
    const image = room.images.find((item) => item.id === imageId);
    if (!image) {
      throw new NotFoundException('Fotografia nao encontrada');
    }
    await this.prisma.roomImage.delete({ where: { id: imageId } });
    await this.uploads.remove(image.file);
    return this.findOne(id, user);
  }
}
