import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads';
import { checkDomain, domainVariants, siteTarget } from './domains';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
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

  async create({ accommodationTaxRateId: _ignored, ...dto }: CreateHotelDto) {
    await this.assertDomainFree(dto.customDomain);
    return this.prisma.hotel.create({ data: dto });
  }

  async domainCheck(id: number, user: JwtPayload) {
    const hotel = await this.findOne(id, user);
    if (!hotel.customDomain) {
      throw new BadRequestException('Este hotel nao tem dominio proprio');
    }
    return checkDomain(hotel.customDomain, this.target());
  }

  private target() {
    return siteTarget(this.config.get<string>('SITE_DNS_TARGET'), this.config.get<string>('CORS_ORIGIN'));
  }

  private async assertDomainFree(domain: string | null | undefined, exceptId?: number) {
    if (!domain) return;
    const variants = domainVariants(domain);
    const target = this.target();
    if (target && variants.includes(target)) {
      throw new BadRequestException('Esse e o endereco do proprio sistema: usa o dominio do site do hotel');
    }
    const taken = await this.prisma.hotel.findFirst({ where: { customDomain: { in: variants }, id: exceptId ? { not: exceptId } : undefined }, select: { name: true } });
    if (taken) {
      throw new ConflictException(`O dominio ja esta associado ao hotel ${taken.name}`);
    }
  }

  async update(id: number, dto: UpdateHotelDto) {
    await this.assertDomainFree(dto.customDomain, id);
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
