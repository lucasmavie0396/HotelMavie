import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './tax-rates.dto';

class HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.prisma.taxRate.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: [{ active: 'desc' }, { rate: 'desc' }],
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  create(@Body() { hotelId, ...data }: CreateTaxRateDto, @CurrentUser() user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    if (data.rate === 0 && !data.exemptionReason) {
      throw new BadRequestException('Uma taxa de 0% precisa do motivo de isencao');
    }
    return this.prisma.taxRate.create({ data: { ...data, hotelId: scoped } });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaxRateDto, @CurrentUser() user: JwtPayload) {
    const rate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!rate || !canAccessHotel(user, rate.hotelId)) {
      throw new NotFoundException('Taxa nao encontrada');
    }
    return this.prisma.taxRate.update({ where: { id }, data: dto });
  }
}
