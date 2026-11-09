import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AccessService } from '../access/access';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { jsonValue } from '../prisma/database';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { publicUserSelect } from './user.select';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  private async withProfile<T extends { profileId?: number | null; role?: UserRole; hotelId?: number }>(data: T, currentHotelId?: number | null): Promise<T> {
    if (data.role === UserRole.ADMIN) return { ...data, profileId: null };
    if (!data.profileId) return data;
    const profile = await this.prisma.accessProfile.findUnique({ where: { id: data.profileId } });
    if (!profile) throw new NotFoundException('Perfil nao encontrado');
    if (profile.hotelId !== (data.hotelId ?? currentHotelId)) throw new BadRequestException('O perfil tem de ser do mesmo hotel do utilizador');
    return { ...data, role: profile.baseRole };
  }

  findAll() {
    return this.prisma.user.findMany({ select: publicUserSelect, orderBy: { name: 'asc' } });
  }

  findOne(id: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: publicUserSelect });
  }

  async create({ password, email, ...data }: CreateUserDto) {
    return this.prisma.user.create({
      data: { ...(await this.withProfile(data)), email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) },
      select: publicUserSelect,
    });
  }

  async update(id: number, { password, email, ...data }: UpdateUserDto, actor: JwtPayload) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: publicUserSelect });
    const revokeSessions = Boolean(password) || data.active === false;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(await this.withProfile(data, before.hotelId)),
        ...(email ? { email: email.toLowerCase() } : {}),
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: publicUserSelect,
    });
    this.access.invalidate();
    if (revokeSessions) {
      await this.prisma.userSession.deleteMany({ where: { userId: id } });
    }
    const changes = (['name', 'email', 'role', 'active', 'hotelId', 'profileId'] as const)
      .filter((key) => before[key] !== user[key])
      .map((key) => ({ field: key, from: before[key], to: user[key] }));
    if (changes.length || password) {
      await this.audit.log({
        hotelId: user.hotelId,
        userId: actor.sub,
        action: 'USER_CHANGE',
        entity: 'user',
        entityId: id,
        summary: `${user.name}: ${[...changes.map((change) => `${change.field} ${String(change.from)} -> ${String(change.to)}`), ...(password ? ['password alterada'] : [])].join(', ')}`,
        data: { changes, passwordChanged: Boolean(password) },
      });
    }
    return user;
  }

  async resetTwoFactor(id: number, actor: JwtPayload) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecoveryCodes: jsonValue([]) },
      select: publicUserSelect,
    });
    await this.prisma.userSession.deleteMany({ where: { userId: id } });
    await this.audit.log({ hotelId: user.hotelId, userId: actor.sub, action: 'USER_2FA_RESET', entity: 'user', entityId: id, summary: `2FA de ${user.name} desativado por um administrador` });
    return user;
  }
}
