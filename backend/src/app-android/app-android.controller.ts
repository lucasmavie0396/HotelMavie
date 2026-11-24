import { Controller, Get, Head, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';
import { Public } from '../common/decorators/public.decorator';

export const APK_NAME = 'MAVIE-HGest.apk';

export function apkFile() {
  return process.env.APP_APK_FILE || resolve(__dirname, '..', '..', '..', 'android', APK_NAME);
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry!.address)
    .sort((a, b) => Number(/^(192\.168|10\.|172\.)/.test(b)) - Number(/^(192\.168|10\.|172\.)/.test(a)));
}

@Controller('app')
export class AppAndroidController {
  @Public()
  @Get(APK_NAME)
  download(@Res() res: Response) {
    this.send(res, false);
  }

  @Public()
  @Head(APK_NAME)
  head(@Res() res: Response) {
    this.send(res, true);
  }

  @Get('info')
  async info() {
    const file = apkFile();
    const available = existsSync(file);
    const stat = available ? statSync(file) : null;
    const port = Number(process.env.PORT ?? 3000);
    const qr = (text: string) => QRCode.toDataURL(text, { margin: 1, width: 240 });
    const servers = [];
    for (const address of lanAddresses()) {
      const server = `http://${address}:${port}`;
      const download = `${server}/api/app/${APK_NAME}`;
      const panel = `mavie://ligar?servidor=${encodeURIComponent(server)}&modo=painel`;
      const room = `mavie://ligar?servidor=${encodeURIComponent(server)}&modo=quarto`;
      servers.push({ address, server, download, downloadQr: await qr(download), panelQr: await qr(panel), roomQr: await qr(room) });
    }
    return { available, size: stat?.size ?? null, updatedAt: stat?.mtime ?? null, path: `/api/app/${APK_NAME}`, servers };
  }

  private send(res: Response, headOnly: boolean) {
    const file = apkFile();
    if (!existsSync(file)) {
      throw new NotFoundException('A app Android ainda nao esta neste servidor');
    }
    res.setHeader('Cache-Control', 'no-cache');
    if (headOnly) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', String(statSync(file).size));
      res.end();
      return;
    }
    res.download(join(file), APK_NAME, { headers: { 'Content-Type': 'application/vnd.android.package-archive' }, acceptRanges: true });
  }
}
