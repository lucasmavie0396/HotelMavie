import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ROOMS = [
  { number: '101', type: 'Standard', capacity: 2, pricePerNight: 60, floor: 1 },
  { number: '102', type: 'Standard', capacity: 2, pricePerNight: 60, floor: 1 },
  { number: '201', type: 'Superior', capacity: 3, pricePerNight: 85, floor: 2 },
  { number: '301', type: 'Suite', capacity: 4, pricePerNight: 140, floor: 3 },
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@maviehgest.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Define SEED_ADMIN_PASSWORD com pelo menos 8 caracteres');
  }

  const name = process.env.SEED_HOTEL_NAME || 'Hotel Mavie';
  const slug = process.env.SEED_HOTEL_SLUG || 'hotel-mavie';
  const rooms = process.env.SEED_DEMO_ROOMS === '0' ? [] : ROOMS;

  const hotel = await prisma.hotel.upsert({
    where: { publicSlug: slug },
    update: {},
    create: { name, publicSlug: slug, publicEnabled: rooms.length > 0 },
  });

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Administrador',
      email,
      role: UserRole.ADMIN,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { hotelId_number: { hotelId: hotel.id, number: room.number } },
      update: {},
      create: { ...room, hotelId: hotel.id },
    });
  }

  console.log(`Seed concluido: hotel "${hotel.name}", admin ${email}, ${rooms.length} quartos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
