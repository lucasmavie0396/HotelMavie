import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const SALES_KEY = 'salesAccess';
export const SalesAccess = () => SetMetadata(SALES_KEY, true);

export const isManagerRole = (role: UserRole) => role === UserRole.ADMIN || role === UserRole.MANAGER;
