import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { canAccessHotel, resolveHotelScope } from './hotel-scope';

const admin = { sub: 1, role: UserRole.ADMIN, hotelId: null };
const reception = { sub: 2, role: UserRole.RECEPTION, hotelId: 10 };
const orphan = { sub: 3, role: UserRole.MANAGER, hotelId: null };

describe('hotel-scope', () => {
  it('administrador ve todos os hoteis ou o pedido', () => {
    expect(resolveHotelScope(admin)).toBeUndefined();
    expect(resolveHotelScope(admin, 5)).toBe(5);
    expect(canAccessHotel(admin, 99)).toBe(true);
  });

  it('restantes papeis ficam presos ao seu hotel', () => {
    expect(resolveHotelScope(reception)).toBe(10);
    expect(resolveHotelScope(reception, 10)).toBe(10);
    expect(() => resolveHotelScope(reception, 11)).toThrow(ForbiddenException);
    expect(canAccessHotel(reception, 11)).toBe(false);
  });

  it('utilizador sem hotel nao ve nada', () => {
    expect(() => resolveHotelScope(orphan)).toThrow(ForbiddenException);
  });
});
