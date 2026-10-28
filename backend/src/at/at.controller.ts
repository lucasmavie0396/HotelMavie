import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { InvoiceType, UserRole } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, Length, Matches } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { seriesCode } from '../billing/invoices.service';
import { AtSigningService } from './at-signing.service';
import { SaftService } from './saft.service';

class CreateSeriesDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsEnum(InvoiceType)
  type: InvoiceType;
}

class SeriesCodeDto {
  @Matches(/^[A-Z0-9]{8,}$/, { message: 'O codigo de validacao da AT tem pelo menos 8 caracteres (letras maiusculas e numeros)' })
  atValidationCode: string;
}

class SaftQueryDto extends HotelQueryDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  from: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  to: string;
}

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller()
export class AtController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: AtSigningService,
    private readonly saft: SaftService,
  ) {}

  @Get('at/status')
  status() {
    return { certified: this.signing.certified, certificateNumber: this.signing.certificateNumber, keyVersion: this.signing.keyVersion };
  }

  @Roles(UserRole.ADMIN)
  @Get('at/public-key')
  publicKey(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="mavie-hgest-public-key.pem"');
    res.send(this.signing.publicKeyPem);
  }

  @Get('invoice-series')
  series(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.prisma.invoiceSeries.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: [{ code: 'desc' }, { type: 'asc' }],
    });
  }

  @Post('invoice-series')
  async createSeries(@Body() dto: CreateSeriesDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const code = seriesCode(new Date());
    await this.prisma.$executeRaw`INSERT IGNORE INTO invoice_series (hotelId, type, code, nextNumber, active, createdAt) VALUES (${hotelId}, ${dto.type}, ${code}, 1, true, NOW(3))`;
    return this.prisma.invoiceSeries.findUniqueOrThrow({ where: { hotelId_type_code: { hotelId, type: dto.type, code } } });
  }

  @Patch('invoice-series/:id')
  async setCode(@Param('id', ParseIntPipe) id: number, @Body() dto: SeriesCodeDto, @CurrentUser() user: JwtPayload) {
    const series = await this.prisma.invoiceSeries.findUnique({ where: { id } });
    if (!series || !canAccessHotel(user, series.hotelId)) {
      throw new NotFoundException('Serie nao encontrada');
    }
    const { count } = await this.prisma.invoiceSeries.updateMany({
      where: { id, nextNumber: 1 },
      data: { atValidationCode: dto.atValidationCode },
    });
    if (!count) {
      throw new ConflictException('A serie ja tem documentos emitidos: o codigo AT tem de ser registado antes do primeiro documento');
    }
    return this.prisma.invoiceSeries.findUniqueOrThrow({ where: { id } });
  }

  @Get('saft')
  async export(@Query() query: SaftQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const { filename, xml } = await this.saft.export(hotelId, query.from, query.to);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  }
}
