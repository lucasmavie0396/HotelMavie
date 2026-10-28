import { Prisma } from '@prisma/client';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  hotelId: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
