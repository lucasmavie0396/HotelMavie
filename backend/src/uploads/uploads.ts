import { BadRequestException, Controller, Get, Global, Injectable, Module, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { get as httpsGet } from 'node:https';
import { BlockList, isIP, LookupFunction } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Public } from '../common/decorators/public.decorator';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9]{32}\.(png|jpg|webp)$/;
const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export class ImageUploadDto {
  @IsString()
  @MaxLength(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100)
  data: string;
}

type ImageKind = 'png' | 'jpg' | 'webp';

const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE_RANGES.check(mapped[1], 'ipv4');
  return PRIVATE_RANGES.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses as LookupAddress[];
    const blocked = list.find((entry) => isPrivateAddress(entry.address));
    if (!list.length || blocked) {
      return callback(Object.assign(new Error('Endereco interno nao permitido'), { code: 'EBLOCKED' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export async function downloadImage(rawUrl: string, redirects = 3): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Endereco da imagem invalido');
  }
  if (url.protocol !== 'https:') {
    throw new BadRequestException('So sao aceites enderecos https');
  }
  if (isIP(url.hostname) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new BadRequestException('Endereco interno nao permitido');
  }
  return new Promise<Buffer>((resolve, reject) => {
    const request = httpsGet(
      url,
      { lookup: publicLookup, timeout: 15_000, headers: { 'User-Agent': 'MAVIE-HGest/1.0 (gestao hoteleira)', Accept: 'image/*' } },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects <= 0) return reject(new BadRequestException('Demasiados redirecionamentos'));
          return resolve(downloadImage(new URL(response.headers.location, url).toString(), redirects - 1));
        }
        if (status !== 200) {
          response.resume();
          return reject(new BadRequestException(`O servidor da imagem respondeu ${status}`));
        }
        if (Number(response.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) {
          response.destroy();
          return reject(new BadRequestException('A imagem tem mais de 4 MB'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            response.destroy();
            reject(new BadRequestException('A imagem tem mais de 4 MB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', () => reject(new BadRequestException('Falha ao descarregar a imagem')));
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error: NodeJS.ErrnoException) =>
      reject(new BadRequestException(error.code === 'EBLOCKED' ? 'Endereco interno nao permitido' : 'Nao foi possivel descarregar a imagem')),
    );
  });
}

export function detectImage(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

@Injectable()
export class UploadsService {
  readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') || 'uploads');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  saveImage(data: string, allowed: ImageKind[] = ['png', 'jpg', 'webp']) {
    return this.saveBytes(Buffer.from(data.replace(/^data:[^;,]*;base64,/, ''), 'base64'), allowed);
  }

  async saveRemote(url: string, allowed: ImageKind[] = ['png', 'jpg', 'webp']) {
    return this.saveBytes(await downloadImage(url), allowed);
  }

  async saveBytes(bytes: Buffer, allowed: ImageKind[] = ['png', 'jpg', 'webp']) {
    if (!bytes.length) throw new BadRequestException('Imagem vazia');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BadRequestException('A imagem tem mais de 4 MB');
    const kind = detectImage(bytes);
    if (!kind || !allowed.includes(kind)) {
      throw new BadRequestException(`Formato de imagem nao suportado (aceites: ${allowed.map((item) => item.toUpperCase()).join(', ')})`);
    }
    const file = `${randomBytes(16).toString('hex')}.${kind}`;
    await writeFile(join(this.dir, file), bytes);
    return file;
  }

  async remove(file: string | null | undefined) {
    if (!file || !FILE_NAME.test(file)) return;
    await unlink(join(this.dir, file)).catch(() => undefined);
  }

  async read(file: string) {
    if (!FILE_NAME.test(file)) throw new NotFoundException('Ficheiro nao encontrado');
    try {
      return { bytes: await readFile(join(this.dir, file)), contentType: CONTENT_TYPES[file.split('.')[1]] };
    } catch {
      throw new NotFoundException('Ficheiro nao encontrado');
    }
  }
}

@Public()
@Controller('public/files')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':file')
  async file(@Param('file') file: string, @Res() res: Response) {
    const { bytes, contentType } = await this.uploads.read(file);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  }
}

@Global()
@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
