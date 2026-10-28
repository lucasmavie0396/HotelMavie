import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthRequest, JwtPayload } from '../../auth/jwt-payload';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => context.switchToHttp().getRequest<AuthRequest>().user!,
);
