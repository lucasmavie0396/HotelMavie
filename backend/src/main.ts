import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
  const config = app.get(ConfigService);
  const port = Number(config.get('PORT') ?? 3000);
  const host = config.get<string>('HOST') || undefined;
  await (host ? app.listen(port, host) : app.listen(port));
  console.log(`MAVIE-HGest a escutar em http://${host ?? '0.0.0.0'}:${port}${config.get('FRONTEND_DIR') ? ' (API e painel)' : ' (API)'}`);
}

bootstrap();
