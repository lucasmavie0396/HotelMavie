import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'keys/at-private.pem');
if (existsSync(target)) {
  console.error(`Ja existe uma chave em ${target}. Nao a substituas: os documentos emitidos ficariam com assinaturas impossiveis de verificar.`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
mkdirSync(dirname(target), { recursive: true });
const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' });
writeFileSync(target, privatePem, { mode: 0o600 });
writeFileSync(target.replace(/\.pem$/, '') + '-public.pem', publicKey.export({ type: 'spki', format: 'pem' }));

console.log(`Chave privada: ${target}`);
console.log(`Chave publica: ${target.replace(/\.pem$/, '')}-public.pem`);
console.log('Para usar numa variavel de ambiente (AT_PRIVATE_KEY), copia este valor numa so linha:');
console.log(privatePem.toString().trim().replace(/\n/g, '\\n'));
