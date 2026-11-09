import { Prisma } from '@prisma/client';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  hotelId: true,
  profileId: true,
  profile: { select: { id: true, name: true } },
  totpEnabled: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
