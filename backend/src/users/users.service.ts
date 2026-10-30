import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { publicUserSelect } from './user.select';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({ select: publicUserSelect, orderBy: { name: 'asc' } });
  }

  findOne(id: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: publicUserSelect });
  }

  async create({ password, email, ...data }: CreateUserDto) {
    return this.prisma.user.create({
      data: { ...data, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) },
      select: publicUserSelect,
    });
  }

  async update(id: number, { password, email, ...data }: UpdateUserDto, actor: JwtPayload) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: publicUserSelect });
    const revokeSessions = Boolean(password) || data.active === false;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        ...(email ? { email: email.toLowerCase() } : {}),
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: publicUserSelect,
    });
    if (revokeSessions) {
      await this.prisma.userSession.deleteMany({ where: { userId: id } });
    }
    const changes = (['name', 'email', 'role', 'active', 'hotelId'] as const)
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
      data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecoveryCodes: [] },
      select: publicUserSelect,
    });
    await this.prisma.userSession.deleteMany({ where: { userId: id } });
    await this.audit.log({ hotelId: user.hotelId, userId: actor.sub, action: 'USER_2FA_RESET', entity: 'user', entityId: id, summary: `2FA de ${user.name} desativado por um administrador` });
    return user;
  }
}
