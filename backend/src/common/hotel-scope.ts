import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';

export function resolveHotelScope(user: JwtPayload, requestedHotelId?: number) {
  if (user.role === UserRole.ADMIN) {
    return requestedHotelId;
  }
  if (!user.hotelId) {
    throw new ForbiddenException('Utilizador sem hotel associado');
  }
  if (requestedHotelId && requestedHotelId !== user.hotelId) {
    throw new ForbiddenException('Sem acesso a este hotel');
  }
  return user.hotelId;
}

export function canAccessHotel(user: JwtPayload, hotelId: number) {
  return user.role === UserRole.ADMIN || user.hotelId === hotelId;
}
