import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { publicUserSelect } from './user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(id: number, { password, email, ...data }: UpdateUserDto) {
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
    return user;
  }
}
