import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { translateErrors } from './common/i18n';

export function trustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '') return 1;
  if (['false', '0', 'no', 'nao'].includes(value.toLowerCase())) return false;
  if (value.toLowerCase() === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function securityHeaders(res: Response) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

export function serveFrontend(app: NestExpressApplication, directory: string) {
  const root = resolve(directory);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`FRONTEND_DIR=${directory}: nao existe ${index}. Corre "npm --prefix frontend run build".`);
  }
  app.useStaticAssets(root, {
    index: false,
    setHeaders: (res, path) => {
      securityHeaders(res);
      res.setHeader('Cache-Control', path.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (req.path.startsWith('/assets/') || /\.[a-z0-9]{1,8}$/i.test(req.path)) {
      res.status(404).end();
      return;
    }
    securityHeaders(res);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  app.set('trust proxy', trustProxy(config.get<string>('TRUST_PROXY')));
  app.setGlobalPrefix('api');
  app.use(translateErrors);
  app.useBodyParser('json', { limit: '8mb' });
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((origin) => origin.trim()) : true,
    credentials: true,
  });
  const frontendDir = config.get<string>('FRONTEND_DIR');
  if (frontendDir) {
    serveFrontend(app, frontendDir);
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
