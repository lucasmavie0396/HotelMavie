import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AccessService } from '../../access/access';
import { allowsArea, areaForRoute } from '../../access/areas';
import { ROLES_KEY, SALES_KEY } from '../../common/decorators/roles.decorator';
import { AuthRequest } from '../jwt-payload';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = request.user;
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const sales = this.reflector.getAllAndOverride<boolean>(SALES_KEY, targets) ?? false;

    if (user && user.role !== UserRole.ADMIN) {
      const levels = await this.access.levelsFor(user.sub);
      const area = levels ? areaForRoute(String(request.route?.path ?? ''), request.method) : null;
      if (levels && area) {
        if (roles?.length === 1 && roles[0] === UserRole.ADMIN) throw new ForbiddenException('Sem permissao para esta operacao');
        if (!allowsArea(levels, area, request.method, sales)) throw new ForbiddenException('Sem permissao para esta operacao');
        return true;
      }
    }

    if (user?.role === UserRole.CASHIER && !sales) {
      throw new ForbiddenException('Sem permissao para esta operacao');
    }
    if (!roles?.length) {
      return true;
    }
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Sem permissao para esta operacao');
    }
    return true;
  }
}
