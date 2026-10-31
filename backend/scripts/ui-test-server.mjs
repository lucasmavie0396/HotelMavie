import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(backend, '.env'), quiet: true });

const source = process.env.UI_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!source) throw new Error('Define DATABASE_URL ou UI_TEST_DATABASE_URL no backend/.env');
const url = new URL(source);
if (!process.env.UI_TEST_DATABASE_URL) url.pathname = `${url.pathname.replace(/^\//, '')}_ui_test`;
const name = url.pathname.replace(/^\//, '');
if (!/^[A-Za-z0-9_]+_test$/.test(name)) throw new Error(`Recusado: a base de dados dos testes de interface tem de terminar em _test (${name})`);

const server = new URL(url);
server.pathname = '/information_schema';
const admin = new PrismaClient({ datasourceUrl: server.toString() });
await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
await admin.$disconnect();
execSync('npx prisma migrate deploy', { cwd: backend, env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' }, stdio: 'pipe' });

const prisma = new PrismaClient({ datasourceUrl: url.toString() });
const hotel = await prisma.hotel.create({ data: { name: 'Hotel Interface', publicSlug: 'hotel-interface', publicEnabled: true, currency: 'EUR', depositPercent: 0 } });
const lodging = await prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Alojamento', rate: 6, atCategory: 'RED' } });
await prisma.hotel.update({ where: { id: hotel.id }, data: { accommodationTaxRateId: lodging.id } });
const normal = await prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23, atCategory: 'NOR' } });
await prisma.room.create({ data: { hotelId: hotel.id, number: '101', type: 'Standard', capacity: 2, pricePerNight: 80 } });
const kitchen = await prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', outlet: 'RESTAURANT', prepStation: 'KITCHEN' } });
const drinks = await prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', prepStation: 'BAR' } });
await prisma.product.create({ data: { hotelId: hotel.id, name: 'Bitoque', sku: 'UI-1', price: 12, taxRateId: normal.id, categoryId: kitchen.id } });
const beer = await prisma.product.create({ data: { hotelId: hotel.id, name: 'Imperial', sku: 'UI-2', price: 2, cost: 0.6, taxRateId: normal.id, categoryId: drinks.id, trackStock: true, minStock: 40 } });
const warehouse = await prisma.warehouse.create({ data: { hotelId: hotel.id, name: 'Economato', isDefault: true } });
await prisma.stockLevel.create({ data: { warehouseId: warehouse.id, productId: beer.id, quantity: 30 } });
await prisma.supplier.create({ data: { hotelId: hotel.id, name: 'Fornecedor Interface', email: 'fornecedor@teste.local' } });
await prisma.printer.createMany({
  data: ['RECEIPT', 'KITCHEN', 'BAR'].map((purpose) => ({ hotelId: hotel.id, name: `PDF ${purpose}`, purpose, output: 'PDF', isDefault: true })),
});
await prisma.diningTable.createMany({ data: [1, 2, 3].map((number) => ({ hotelId: hotel.id, outlet: 'RESTAURANT', number, seats: 4 })) });
await prisma.employee.create({
  data: { hotelId: hotel.id, fullName: 'Rita Costa', jobTitle: 'Rececionista', startDate: new Date('2020-01-01'), baseSalary: 900, irsRate: 5, weeklyHours: 40 },
});
await prisma.user.create({
  data: { name: 'Gestor Interface', email: 'gestor-ui@teste.local', role: 'MANAGER', hotelId: hotel.id, passwordHash: await bcrypt.hash('Teste-UI-1234', 4) },
});
await prisma.user.create({
  data: { name: 'Caixa Interface', email: 'caixa-ui@teste.local', role: 'CASHIER', hotelId: hotel.id, passwordHash: await bcrypt.hash('Teste-UI-1234', 4) },
});
await prisma.$disconnect();

const uploads = join(tmpdir(), 'mavie-ui-test-uploads');
rmSync(uploads, { recursive: true, force: true });
mkdirSync(uploads, { recursive: true });
Object.assign(process.env, {
  DATABASE_URL: url.toString(),
  PORT: process.env.UI_TEST_PORT ?? '3100',
  HOST: '127.0.0.1',
  FRONTEND_DIR: resolve(backend, '..', 'frontend', 'dist'),
  UPLOAD_DIR: uploads,
  SMTP_HOST: '',
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET || 'segredo-de-teste-access',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'segredo-de-teste-refresh',
});
await import(pathToFileURL(join(backend, 'dist', 'main.js')).href);
