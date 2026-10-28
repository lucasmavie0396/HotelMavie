import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect } from '../users/user.select';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const valid = user?.active && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciais invalidas');
    }
    await this.prisma.userSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
    return this.issueTokens(user, undefined, userAgent);
  }

  async refresh(refreshToken: string, userAgent?: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Sessao expirada');
    }

    const session = await this.prisma.userSession.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!session) {
      await this.prisma.userSession.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Sessao expirada');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user?.active || session.expiresAt < new Date()) {
      await this.prisma.userSession.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Sessao expirada');
    }
    return this.issueTokens(user, session.id, userAgent);
  }

  async logout(userId: number, refreshToken?: string) {
    await this.prisma.userSession.deleteMany({
      where: { userId, ...(refreshToken ? { tokenHash: hashToken(refreshToken) } : {}) },
    });
  }

  me(userId: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
  }

  private async issueTokens(user: User, sessionId?: number, userAgent?: string) {
    const payload: JwtPayload = { sub: user.id, role: user.role, hotelId: user.hotelId };
    const refreshSeconds = Number(this.config.get('JWT_REFRESH_EXPIRES_IN_SECONDS') ?? 604800);
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: Number(this.config.get('JWT_EXPIRES_IN_SECONDS') ?? 900),
      }),
      this.jwt.signAsync(
        { ...payload, jti: randomUUID() },
        { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshSeconds },
      ),
    ]);

    const data = {
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshSeconds * 1000),
      userAgent: userAgent?.slice(0, 255),
      lastUsedAt: new Date(),
    };
    if (sessionId) {
      await this.prisma.userSession.update({ where: { id: sessionId }, data });
    } else {
      await this.prisma.userSession.create({ data: { ...data, userId: user.id } });
    }

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, hotelId: user.hotelId },
    };
  }
}
