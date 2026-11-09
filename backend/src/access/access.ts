import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Global, HttpCode, HttpStatus, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AccessLevel, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_AREAS, AccessLevels, completeLevels, DEFAULT_LEVELS } from './areas';

const CACHE_MS = 15_000;

export class AccessProfileQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

export class CreateAccessProfileDto {
  @IsInt()
  hotelId: number;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEnum(UserRole)
  baseRole: UserRole;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, AccessLevel>;
}

export class UpdateAccessProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, AccessLevel>;
}

const include = { permissions: true, _count: { select: { users: true } } };

@Injectable()
export class AccessService {
  private readonly cache = new Map<number, { at: number; levels: AccessLevels | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  invalidate() {
    this.cache.clear();
  }

  async levelsFor(userId: number): Promise<AccessLevels | null> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.levels;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, profile: { select: { permissions: { select: { area: true, level: true } } } } } });
    const levels = user?.profile && user.role !== UserRole.ADMIN ? completeLevels(Object.fromEntries(user.profile.permissions.map((item) => [item.area, item.level]))) : null;
    this.cache.set(userId, { at: Date.now(), levels });
    return levels;
  }

  catalog() {
    return { areas: ACCESS_AREAS, defaults: DEFAULT_LEVELS };
  }

  private shape<T extends { permissions: { area: string; level: AccessLevel }[]; _count: { users: number } }>({ permissions, _count, ...profile }: T) {
    return { ...profile, users: _count.users, permissions: completeLevels(Object.fromEntries(permissions.map((item) => [item.area, item.level]))) };
  }

  private rows(permissions: Record<string, AccessLevel>) {
    const levels = Object.values(AccessLevel) as string[];
    for (const [area, level] of Object.entries(permissions)) {
      if (!(ACCESS_AREAS as readonly string[]).includes(area)) throw new BadRequestException(`Area desconhecida: ${area}`);
      if (!levels.includes(level)) throw new BadRequestException(`Nivel invalido: ${level}`);
    }
    return Object.entries(completeLevels(permissions)).map(([area, level]) => ({ area, level }));
  }

  async findAll(hotelId?: number) {
    const profiles = await this.prisma.accessProfile.findMany({ where: { hotelId }, include, orderBy: { name: 'asc' } });
    return profiles.map((profile) => this.shape(profile));
  }

  private async assertUniqueName(hotelId: number, name: string, ignoreId?: number) {
    const clash = await this.prisma.accessProfile.findFirst({ where: { hotelId, name, ...(ignoreId ? { id: { not: ignoreId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException('Ja existe um perfil com este nome');
  }

  async create(dto: CreateAccessProfileDto, actor: JwtPayload) {
    if (dto.baseRole === UserRole.ADMIN) throw new BadRequestException('O perfil nao pode ser baseado em Administrador');
    const name = dto.name.trim();
    await this.assertUniqueName(dto.hotelId, name);
    const profile = await this.prisma.accessProfile.create({
      data: { hotelId: dto.hotelId, name, baseRole: dto.baseRole, permissions: { create: this.rows(dto.permissions ?? DEFAULT_LEVELS[dto.baseRole]) } },
      include,
    });
    await this.audit.log({ hotelId: dto.hotelId, userId: actor.sub, action: 'ACCESS_PROFILE_CHANGE', entity: 'access-profile', entityId: profile.id, summary: `Perfil ${name} criado` });
    return this.shape(profile);
  }

  async update(id: number, dto: UpdateAccessProfileDto, actor: JwtPayload) {
    const current = await this.prisma.accessProfile.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Perfil nao encontrado');
    const name = dto.name?.trim();
    if (name) await this.assertUniqueName(current.hotelId, name, id);
    const rows = dto.permissions ? this.rows(dto.permissions) : null;
    const profile = await this.prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.accessProfilePermission.deleteMany({ where: { profileId: id } });
        await tx.accessProfilePermission.createMany({ data: rows.map((row) => ({ ...row, profileId: id })) });
      }
      return tx.accessProfile.update({ where: { id }, data: { name }, include });
    });
    this.invalidate();
    await this.audit.log({ hotelId: current.hotelId, userId: actor.sub, action: 'ACCESS_PROFILE_CHANGE', entity: 'access-profile', entityId: id, summary: `Perfil ${profile.name} alterado` });
    return this.shape(profile);
  }

  async remove(id: number, actor: JwtPayload) {
    const current = await this.prisma.accessProfile.findUnique({ where: { id }, include });
    if (!current) throw new NotFoundException('Perfil nao encontrado');
    if (current._count.users) throw new ConflictException('Ha utilizadores com este perfil: muda-os de perfil primeiro');
    await this.prisma.accessProfile.delete({ where: { id } });
    this.invalidate();
    await this.audit.log({ hotelId: current.hotelId, userId: actor.sub, action: 'ACCESS_PROFILE_CHANGE', entity: 'access-profile', entityId: id, summary: `Perfil ${current.name} removido` });
  }
}

@Roles(UserRole.ADMIN)
@Controller('access-profiles')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('areas')
  areas() {
    return this.access.catalog();
  }

  @Get()
  findAll(@Query() query: AccessProfileQueryDto) {
    return this.access.findAll(query.hotelId);
  }

  @Post()
  create(@Body() dto: CreateAccessProfileDto, @CurrentUser() user: JwtPayload) {
    return this.access.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccessProfileDto, @CurrentUser() user: JwtPayload) {
    return this.access.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.access.remove(id, user);
  }
}

@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
