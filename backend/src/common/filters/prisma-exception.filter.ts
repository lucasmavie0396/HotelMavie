import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const KNOWN_ERRORS: Record<string, [HttpStatus, string]> = {
  P2002: [HttpStatus.CONFLICT, 'Ja existe um registo com estes dados'],
  P2003: [HttpStatus.CONFLICT, 'O registo esta associado a outros dados'],
  P2025: [HttpStatus.NOT_FOUND, 'Registo nao encontrado'],
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const known = KNOWN_ERRORS[exception.code];

    if (!known) {
      this.logger.error(exception.message, exception.stack);
    }

    const [statusCode, message] = known ?? [HttpStatus.INTERNAL_SERVER_ERROR, 'Erro interno'];
    response.status(statusCode).json({ statusCode, message });
  }
}
