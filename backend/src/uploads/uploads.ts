import { BadRequestException, Controller, Get, Global, Injectable, Module, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
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

  async saveImage(data: string, allowed: ('png' | 'jpg' | 'webp')[] = ['png', 'jpg', 'webp']) {
    const bytes = Buffer.from(data.replace(/^data:[^;,]*;base64,/, ''), 'base64');
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
