import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { AuditService } from '../audit/audit';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect } from '../users/user.select';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from './totp';

const ROTATION_GRACE_MS = 60_000;
const CHALLENGE_SECONDS = 300;
const RESET_MINUTES = 60;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const valid = user?.active && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      if (user) await this.audit.log({ hotelId: user.hotelId, userId: user.id, action: 'AUTH_LOGIN_FAILED', entity: 'user', entityId: user.id, summary: `Password errada para ${user.email}` });
      throw new UnauthorizedException('Credenciais invalidas');
    }
    await this.prisma.userSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
    if (user.totpEnabled) {
      const challenge = await this.jwt.signAsync({ sub: user.id, purpose: '2fa' }, { secret: this.challengeSecret(), expiresIn: CHALLENGE_SECONDS });
      return { twoFactorRequired: true, challenge };
    }
    return this.issueTokens(user, undefined, userAgent);
  }

  async loginTwoFactor(challenge: string, code: string, userAgent?: string) {
    let payload: { sub: number; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(challenge, { secret: this.challengeSecret() });
    } catch {
      throw new UnauthorizedException('O pedido de codigo expirou: entra outra vez');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (payload.purpose !== '2fa' || !user?.active || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('Credenciais invalidas');
    }
    if (!(await this.consumeCode(user, code))) {
      await this.audit.log({ hotelId: user.hotelId, userId: user.id, action: 'AUTH_LOGIN_FAILED', entity: 'user', entityId: user.id, summary: `Codigo 2FA errado para ${user.email}` });
      throw new UnauthorizedException('Codigo invalido');
    }
    return this.issueTokens(user, undefined, userAgent);
  }

  async twoFactorStatus(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const codes = Array.isArray(user.totpRecoveryCodes) ? user.totpRecoveryCodes.length : 0;
    return { enabled: user.totpEnabled, recoveryCodesLeft: user.totpEnabled ? codes : 0 };
  }

  async setupTwoFactor(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabled) {
      throw new ConflictException('O 2FA ja esta ativo');
    }
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: encryptSecret(secret, this.encryptionKey()), totpLastStep: null } });
    const url = otpauthUrl(secret, user.email, 'MAVIE-HGest');
    return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  async enableTwoFactor(userId: number, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabled) throw new ConflictException('O 2FA ja esta ativo');
    if (!user.totpSecret) throw new BadRequestException('Comeca por gerar o codigo QR');
    const step = verifyTotp(decryptSecret(user.totpSecret, this.encryptionKey()), code, null);
    if (step === null) throw new BadRequestException('Codigo invalido: confirma a hora do telemovel e tenta de novo');
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpLastStep: step, totpRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
    });
    await this.audit.log({ hotelId: user.hotelId, userId, action: 'AUTH_2FA_ENABLED', entity: 'user', entityId: userId, summary: `${user.name} ativou o 2FA` });
    return { enabled: true, recoveryCodes };
  }

  async disableTwoFactor(userId: number, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabled) throw new ConflictException('O 2FA nao esta ativo');
    if (!(await bcrypt.compare(password, user.passwordHash)) || !(await this.consumeCode(user, code))) {
      throw new BadRequestException('Password ou codigo invalidos');
    }
    await this.clearTwoFactor(userId);
    await this.audit.log({ hotelId: user.hotelId, userId, action: 'AUTH_2FA_DISABLED', entity: 'user', entityId: userId, summary: `${user.name} desativou o 2FA` });
    return { enabled: false };
  }

  async clearTwoFactor(userId: number) {
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecoveryCodes: [] } });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user?.active) return { sent: true };
    const recent = await this.prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) } } });
    if (recent >= 3) return { sent: true };
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000) },
    });
    const link = `${this.appUrl()}/repor-password?token=${token}`;
    const message = passwordResetEmail(user.name, link, RESET_MINUTES);
    this.mail.queue({ hotelId: user.hotelId, kind: 'PASSWORD_RESET', to: user.email, subject: message.subject, html: message.html, relatedId: user.id });
    return { sent: true };
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = hashToken(token);
    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active) {
      throw new BadRequestException('O link expirou ou ja foi usado: pede um novo');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!count) throw new BadRequestException('O link expirou ou ja foi usado: pede um novo');
      await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      await tx.userSession.deleteMany({ where: { userId: reset.userId } });
    });
    await this.audit.log({
      hotelId: reset.user.hotelId,
      userId: reset.userId,
      action: 'AUTH_PASSWORD_RESET',
      entity: 'user',
      entityId: reset.userId,
      summary: `${reset.user.name} repos a password pelo link de email`,
    });
    return { reset: true, twoFactorRequired: reset.user.totpEnabled };
  }

  private async consumeCode(user: User, code: string) {
    const step = verifyTotp(decryptSecret(user.totpSecret!, this.encryptionKey()), code, user.totpLastStep);
    if (step !== null) {
      const { count } = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      return count > 0;
    }
    const codes = Array.isArray(user.totpRecoveryCodes) ? (user.totpRecoveryCodes as string[]) : [];
    const hash = hashRecoveryCode(code);
    if (!codes.includes(hash)) return false;
    await this.prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: codes.filter((item) => item !== hash) } });
    return true;
  }

  private challengeSecret() {
    return `${this.config.getOrThrow<string>('JWT_SECRET')}:2fa-challenge`;
  }

  private encryptionKey() {
    return this.config.get<string>('TOTP_ENCRYPTION_KEY') || this.config.getOrThrow<string>('JWT_SECRET');
  }

  private appUrl() {
    const configured = this.config.get<string>('APP_URL') || this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() || 'http://localhost:5173';
    return configured.replace(/\/$/, '');
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

    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({ where: { tokenHash } });
    if (!session) {
      const justRotated = await this.prisma.userSession.findFirst({
        where: { userId: payload.sub, previousTokenHash: tokenHash, rotatedAt: { gt: new Date(Date.now() - ROTATION_GRACE_MS) } },
      });
      if (justRotated) {
        throw new UnauthorizedException('Sessao renovada noutro separador');
      }
      await this.prisma.userSession.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Sessao expirada');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user?.active || session.expiresAt < new Date()) {
      await this.prisma.userSession.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Sessao expirada');
    }
    return this.issueTokens(user, { id: session.id, tokenHash }, userAgent);
  }

  async logout(userId: number, refreshToken?: string) {
    await this.prisma.userSession.deleteMany({
      where: { userId, ...(refreshToken ? { tokenHash: hashToken(refreshToken) } : {}) },
    });
  }

  me(userId: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
  }

  private async issueTokens(user: User, previous?: { id: number; tokenHash: string }, userAgent?: string) {
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
    if (previous) {
      const { count } = await this.prisma.userSession.updateMany({
        where: { id: previous.id, tokenHash: previous.tokenHash },
        data: { ...data, previousTokenHash: previous.tokenHash, rotatedAt: new Date() },
      });
      if (!count) {
        throw new UnauthorizedException('Sessao renovada noutro separador');
      }
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
