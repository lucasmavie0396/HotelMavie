import { BadRequestException, Body, CallHandler, Controller, ExecutionContext, ForbiddenException, Get, Global, HttpCode, HttpStatus, Injectable, Module, NestInterceptor, Post, Query } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Hotel, UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { decodeLicense, decodeUnlock, LicenseData, normalizeLicense, unlockRequest } from './license-format';
import { LICENSE_PUBLIC_KEY } from './public-key';

export type LicenseState = 'VALID' | 'EXPIRING' | 'GRACE' | 'TRIAL' | 'EXPIRED' | 'MISSING' | 'INVALID' | 'CLOCK';

const BLOCKING: LicenseState[] = ['EXPIRED', 'MISSING', 'INVALID', 'CLOCK'];
const GRACE_DAYS = 7;
const TRIAL_DAYS = 30;
const CLOCK_TOLERANCE_MS = 36 * 3600 * 1000;
const CACHE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface LicenseStatus {
  state: LicenseState;
  blocked: boolean;
  message: string;
  name: string | null;
  nuit: string | null;
  validUntil: string | null;
  daysLeft: number | null;
  trialUntil: string | null;
  unlockRequest: string | null;
}

export class ActivateLicenseDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @Length(20, 4000)
  text: string;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const nuitOf = (hotel: Hotel) => (hotel.taxId ?? '').replace(/\D/g, '');

@Injectable()
export class LicenseService {
  private readonly cache = new Map<number, { at: number; status: LicenseStatus }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get publicKey() {
    return process.env.LICENSE_PUBLIC_KEY || LICENSE_PUBLIC_KEY;
  }

  invalidate(hotelId: number) {
    this.cache.delete(hotelId);
  }

  async statusFor(hotelId: number, now = new Date()): Promise<LicenseStatus> {
    const cached = this.cache.get(hotelId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.status;
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new BadRequestException('Hotel nao encontrado');
    const status = this.evaluate(hotel, now);
    if (!hotel.licenseLastSeenAt || now > hotel.licenseLastSeenAt) {
      await this.prisma.hotel.update({ where: { id: hotel.id }, data: { licenseLastSeenAt: now } });
    }
    this.cache.set(hotelId, { at: Date.now(), status });
    return status;
  }

  evaluate(hotel: Hotel, now: Date): LicenseStatus {
    const base = { name: null, nuit: nuitOf(hotel) || null, validUntil: null, daysLeft: null, trialUntil: null, unlockRequest: null } as Omit<LicenseStatus, 'state' | 'blocked' | 'message'>;
    const result = (state: LicenseState, message: string, extra: Partial<LicenseStatus> = {}): LicenseStatus => ({ ...base, ...extra, state, blocked: BLOCKING.includes(state), message });
    if (hotel.licenseLastSeenAt && now.getTime() < hotel.licenseLastSeenAt.getTime() - CLOCK_TOLERANCE_MS) {
      const request = unlockRequest(nuitOf(hotel) || '000000000', hotel.licenseLastSeenAt);
      return result('CLOCK', `A data do servidor esta atrasada em relacao a ultima utilizacao. Acerte a data e a hora; se ja estao certas, peca o codigo de desbloqueio com o pedido ${request}.`, { unlockRequest: request });
    }
    let license: LicenseData | null = null;
    if (hotel.licenseText) {
      const decoded = decodeLicense(hotel.licenseText, this.publicKey);
      if (!decoded.data) return result('INVALID', `Licenca invalida: ${decoded.error}. Ative uma licenca nova.`);
      license = decoded.data;
      if (license.nuit !== nuitOf(hotel)) {
        return result('INVALID', `A licenca e do NUIT ${license.nuit}, mas o hotel tem o NUIT ${nuitOf(hotel) || '(vazio)'}. Corrija o NUIT em Configuracao ou ative a licenca certa.`, { name: license.name });
      }
    }
    if (!license) {
      const trialUntil = hotel.licenseGraceUntil ?? new Date(hotel.createdAt.getTime() + TRIAL_DAYS * DAY_MS);
      if (now < trialUntil) {
        const left = Math.ceil((trialUntil.getTime() - now.getTime()) / DAY_MS);
        return result('TRIAL', `Sistema sem licenca: ative-a nos proximos ${left} dia(s) em Configuracao > Sistema.`, { trialUntil: day(trialUntil), daysLeft: left });
      }
      return result('MISSING', 'Sistema sem licenca: as vendas e as gravacoes estao bloqueadas. O administrador ativa a licenca em Configuracao > Sistema.', { trialUntil: day(trialUntil) });
    }
    const end = new Date(`${license.validUntil}T23:59:59.999Z`);
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
    const info = { name: license.name, nuit: license.nuit, validUntil: license.validUntil, daysLeft };
    const length = (end.getTime() - new Date(`${license.issuedAt}T00:00:00Z`).getTime()) / DAY_MS;
    const warning = length > 45 ? 15 : 5;
    if (daysLeft > warning) return result('VALID', `Licenca valida ate ${license.validUntil}.`, info);
    if (daysLeft > 0) return result('EXPIRING', `A licenca termina a ${license.validUntil} (faltam ${daysLeft} dia(s)). Renove-a para nao bloquear as vendas.`, info);
    if (daysLeft > -GRACE_DAYS) {
      return result('GRACE', `A licenca terminou a ${license.validUntil}. Tem ${GRACE_DAYS + daysLeft} dia(s) de tolerancia antes de as vendas e gravacoes bloquearem.`, info);
    }
    return result('EXPIRED', `A licenca terminou a ${license.validUntil}: as vendas e as gravacoes estao bloqueadas. A consulta e os relatorios continuam.`, info);
  }

  async activate(dto: ActivateLicenseDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });
    const text = normalizeLicense(dto.text);
    const decoded = decodeLicense(text, this.publicKey);
    if (!decoded.data) throw new BadRequestException(`Licenca invalida: ${decoded.error}`);
    if (decoded.data.nuit !== nuitOf(hotel)) {
      throw new BadRequestException(`Esta licenca e do NUIT ${decoded.data.nuit}; o hotel tem o NUIT ${nuitOf(hotel) || '(vazio)'}`);
    }
    if (hotel.licenseText) {
      const current = decodeLicense(hotel.licenseText, this.publicKey).data;
      if (current && current.validUntil > decoded.data.validUntil) {
        throw new BadRequestException(`A licenca ativa vale ate ${current.validUntil}, mais do que esta (${decoded.data.validUntil})`);
      }
    }
    await this.prisma.hotel.update({ where: { id: hotelId }, data: { licenseText: text } });
    this.invalidate(hotelId);
    await this.audit.log({ hotelId, userId: user.sub, action: 'LICENSE_ACTIVATE', entity: 'hotel', entityId: hotelId, summary: `Licenca de ${decoded.data.name} ativada, valida ate ${decoded.data.validUntil}` });
    return this.statusFor(hotelId);
  }

  async unlock(dto: ActivateLicenseDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });
    const decoded = decodeUnlock(dto.text, this.publicKey);
    if (!decoded.data) throw new BadRequestException(`Codigo invalido: ${decoded.error}`);
    if (!hotel.licenseLastSeenAt) throw new BadRequestException('Este sistema nao precisa de desbloqueio');
    const request = unlockRequest(nuitOf(hotel) || '000000000', hotel.licenseLastSeenAt);
    if (decoded.data.request !== request) throw new BadRequestException(`Este codigo e para o pedido ${decoded.data.request}; o pedido deste sistema e ${request}`);
    if (decoded.data.validUntil < day(new Date())) throw new BadRequestException('O codigo de desbloqueio expirou: peca um novo');
    const used: string[] = hotel.licenseUnlocks ? JSON.parse(hotel.licenseUnlocks) : [];
    if (used.includes(decoded.data.id)) throw new BadRequestException('Este codigo ja foi usado');
    await this.prisma.hotel.update({ where: { id: hotelId }, data: { licenseLastSeenAt: new Date(), licenseUnlocks: JSON.stringify([...used, decoded.data.id].slice(-50)) } });
    this.invalidate(hotelId);
    await this.audit.log({ hotelId, userId: user.sub, action: 'LICENSE_UNLOCK', entity: 'hotel', entityId: hotelId, summary: `Relogio desbloqueado com o codigo do pedido ${request}` });
    return this.statusFor(hotelId);
  }

  private hotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('Escolha o hotel');
    return scoped;
  }
}

const OPEN_PATHS = [/^\/api\/auth\//, /^\/api\/license(\/|$)/, /^\/api\/health/, /^\/api\/exports$/, /^\/api\/system\/production/];

@Injectable()
export class LicenseInterceptor implements NestInterceptor {
  constructor(private readonly license: LicenseService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return next.handle();
    const path = request.originalUrl.split('?')[0];
    if (OPEN_PATHS.some((pattern) => pattern.test(path))) return next.handle();
    const user = request.user;
    if (!user) return next.handle();
    const bodyHotel = Number((request.body as { hotelId?: unknown } | undefined)?.hotelId);
    const queryHotel = Number(request.query?.hotelId);
    const hotelId = user.hotelId ?? (Number.isInteger(bodyHotel) && bodyHotel > 0 ? bodyHotel : Number.isInteger(queryHotel) && queryHotel > 0 ? queryHotel : null);
    if (!hotelId) return next.handle();
    const status = await this.license.statusFor(hotelId);
    if (status.blocked) throw new ForbiddenException(status.message);
    return next.handle();
  }
}

@SalesAccess()
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Get()
  status(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (!hotelId) throw new BadRequestException('Escolha o hotel');
    return this.license.statusFor(hotelId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  @HttpCode(HttpStatus.OK)
  activate(@Body() dto: ActivateLicenseDto, @CurrentUser() user: JwtPayload) {
    return this.license.activate(dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  unlock(@Body() dto: ActivateLicenseDto, @CurrentUser() user: JwtPayload) {
    return this.license.unlock(dto, user);
  }
}

@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, { provide: APP_INTERCEPTOR, useClass: LicenseInterceptor }],
  exports: [LicenseService],
})
export class LicenseModule {}
