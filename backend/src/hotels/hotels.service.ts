import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  findAll(user: JwtPayload) {
    return this.prisma.hotel.findMany({
      where: user.role === UserRole.ADMIN ? undefined : { id: user.hotelId ?? -1 },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id } });
    if (!hotel || !canAccessHotel(user, hotel.id)) {
      throw new NotFoundException('Hotel nao encontrado');
    }
    return hotel;
  }

  create({ accommodationTaxRateId: _ignored, ...dto }: CreateHotelDto) {
    return this.prisma.hotel.create({ data: dto });
  }

  async update(id: number, dto: UpdateHotelDto) {
    if (dto.accommodationTaxRateId) {
      const rate = await this.prisma.taxRate.findUnique({ where: { id: dto.accommodationTaxRateId } });
      if (!rate || rate.hotelId !== id) {
        throw new BadRequestException('A taxa de IVA do alojamento tem de pertencer a este hotel');
      }
    }
    return this.prisma.hotel.update({ where: { id }, data: dto });
  }

  async setLogo(id: number, data: string | null, user: JwtPayload) {
    const hotel = await this.findOne(id, user);
    const logoFile = data ? await this.uploads.saveImage(data, ['png', 'jpg']) : null;
    const updated = await this.prisma.hotel.update({ where: { id }, data: { logoFile } });
    await this.uploads.remove(hotel.logoFile);
    return updated;
  }

  remove(id: number) {
    return this.prisma.hotel.delete({ where: { id } });
  }
}
