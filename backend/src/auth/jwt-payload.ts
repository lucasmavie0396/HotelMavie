import { UserRole } from '@prisma/client';
import type { Request } from 'express';

export interface JwtPayload {
  sub: number;
  role: UserRole;
  hotelId: number | null;
  jti?: string;
}

export type AuthRequest = Request & { user?: JwtPayload };
