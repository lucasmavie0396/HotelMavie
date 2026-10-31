import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function requireOpenCash(tx: Prisma.TransactionClient, hotelId: number, userId: number) {
  const session = await tx.cashSession.findFirst({
    where: { openedById: userId, closedAt: null, register: { hotelId } },
    orderBy: { openedAt: 'desc' },
  });
  if (!session) {
    throw new ConflictException('Abre o teu caixa antes de vender ou receber pagamentos');
  }
  return session;
}
