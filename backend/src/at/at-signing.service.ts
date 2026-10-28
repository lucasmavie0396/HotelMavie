import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, createSign, createVerify, generateKeyPairSync, KeyObject, createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

@Injectable()
export class AtSigningService {
  private readonly logger = new Logger(AtSigningService.name);
  private readonly privateKey: KeyObject;
  readonly publicKeyPem: string;
  readonly keyVersion: number;
  readonly certificateNumber: string;

  constructor(config: ConfigService) {
    this.privateKey = createPrivateKey(this.loadKey(config));
    this.publicKeyPem = createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.keyVersion = Number(config.get('AT_KEY_VERSION') ?? 1);
    this.certificateNumber = config.get<string>('AT_CERTIFICATE_NUMBER') || '0';
  }

  private loadKey(config: ConfigService) {
    const inline = config.get<string>('AT_PRIVATE_KEY');
    if (inline) {
      return inline.replace(/\\n/g, '\n');
    }
    const configured = config.get<string>('AT_PRIVATE_KEY_PATH');
    const path = resolve(configured || 'keys/at-private.pem');
    if (existsSync(path)) {
      return readFileSync(path);
    }
    if (configured) {
      throw new Error(`Chave privada AT nao encontrada em ${path}`);
    }
    if (config.get('NODE_ENV') === 'production') {
      throw new Error('Em producao define AT_PRIVATE_KEY (PEM) ou AT_PRIVATE_KEY_PATH: a chave tem de ser sempre a mesma para manter a cadeia de assinaturas');
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: 0o600 });
    this.logger.warn(`Gerada chave RSA de desenvolvimento em ${path}. Em producao usa a chave comunicada a AT.`);
    return readFileSync(path);
  }

  get certified() {
    return this.certificateNumber !== '0';
  }

  sign(message: string) {
    return createSign('RSA-SHA1').update(message, 'utf8').sign(this.privateKey, 'base64');
  }

  verify(message: string, signature: string) {
    return createVerify('RSA-SHA1').update(message, 'utf8').verify(this.publicKeyPem, signature, 'base64');
  }
}
