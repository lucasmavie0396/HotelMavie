import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY, SALES_KEY } from '../../common/decorators/roles.decorator';
import { AuthRequest } from '../jwt-payload';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (user?.role === UserRole.CASHIER && !this.reflector.getAllAndOverride<boolean>(SALES_KEY, targets)) {
      throw new ForbiddenException('Sem permissao para esta operacao');
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (!roles?.length) {
      return true;
    }

    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Sem permissao para esta operacao');
    }
    return true;
  }
}
