import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Teste-1234';

const cashiers: number[] = [];

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
}

export async function createApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }));
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

export function uid() {
  return randomBytes(3).toString('hex');
}

export function day(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function createHotel(prisma: PrismaClient, options: { rooms?: number; accommodationRate?: number | null; depositPercent?: number } = {}) {
  const id = uid();
  const hotel = await prisma.hotel.create({
    data: { name: `Hotel ${id}`, publicSlug: `hotel-${id}`, publicEnabled: true, currency: 'EUR', depositPercent: options.depositPercent ?? 0 },
  });
  const rooms = [];
  for (let index = 1; index <= (options.rooms ?? 3); index++) {
    rooms.push(
      await prisma.room.create({
        data: { hotelId: hotel.id, number: `${100 + index}`, type: index === 3 ? 'Suite' : 'Standard', capacity: index === 3 ? 4 : 2, pricePerNight: index === 3 ? 150 : 80 },
      }),
    );
  }
  let accommodationRate = null;
  const rate = options.accommodationRate === undefined ? 6 : options.accommodationRate;
  if (rate !== null) {
    accommodationRate = await prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Alojamento', rate, atCategory: 'RED' } });
    await prisma.hotel.update({ where: { id: hotel.id }, data: { accommodationTaxRateId: accommodationRate.id } });
  }
  for (const userId of cashiers) {
    await openCash(prisma, userId, hotel.id);
  }
  return { hotel, rooms, accommodationRate };
}

export async function createUser(prisma: PrismaClient, role: UserRole, hotelId: number | null, options: { cash?: boolean } = {}) {
  const email = `${role.toLowerCase()}-${uid()}@teste.local`;
  const user = await prisma.user.create({
    data: { name: `${role} ${email}`, email, role, hotelId, passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  if (hotelId && options.cash !== false) {
    await openCash(prisma, user.id, hotelId);
  }
  if (!hotelId && options.cash !== false) {
    cashiers.push(user.id);
  }
  return { user, email };
}

export async function openCash(prisma: PrismaClient, userId: number, hotelId: number) {
  const register = await prisma.cashRegister.create({ data: { hotelId, name: `Caixa ${uid()}` } });
  return prisma.cashSession.create({ data: { registerId: register.id, openingAmount: 0, openedById: userId } });
}

export async function login(ctx: TestContext, email: string) {
  const response = await ctx
    .http()
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`)
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    auth: { Authorization: `Bearer ${response.body.accessToken}` },
  };
}

export async function createGuest(prisma: PrismaClient, hotelId: number) {
  return prisma.guest.create({ data: { hotelId, firstName: 'Teste', lastName: uid(), email: `${uid()}@teste.local` } });
}
