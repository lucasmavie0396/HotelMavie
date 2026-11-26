import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(process.env.APPDATA ?? join(homedir(), '.config'), 'MAVIE-HGest', 'Licencas');
const PRIVATE_KEY = join(DATA, 'chave-privada.pem');
const REGISTRY = join(DATA, 'registo.json');
const PUBLIC_KEY_TS = join(ROOT, 'backend', 'src', 'license', 'public-key.ts');

function args() {
  const result = { _: [] };
  const list = process.argv.slice(2);
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    if (item.startsWith('--')) {
      const next = list[index + 1];
      result[item.slice(2)] = next && !next.startsWith('--') ? (index++, next) : true;
    } else result._.push(item);
  }
  return result;
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function privateKey() {
  if (!existsSync(PRIVATE_KEY)) fail(`Nao ha chave neste computador (${PRIVATE_KEY}). Crie-a com "chave" ou reponha a copia com "importar".`);
  return createPrivateKey(readFileSync(PRIVATE_KEY, 'utf8'));
}

function encode(prefix, data, key) {
  const bytes = Buffer.from(JSON.stringify(data), 'utf8');
  const signature = sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' });
  return `${prefix}.${bytes.toString('base64url')}.${signature.toString('base64url')}`;
}

function registry(entry) {
  const list = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : [];
  list.push({ ...entry, at: new Date().toISOString(), user: process.env.USERNAME ?? process.env.USER ?? '' });
  writeFileSync(REGISTRY, JSON.stringify(list, null, 2));
}

function writePublicKey(pem) {
  const content = `export const LICENSE_PUBLIC_KEY = \`${pem.trim()}\`;\n`;
  writeFileSync(PUBLIC_KEY_TS, content);
}

const date = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label}: use AAAA-MM-DD`);
  return value;
};

const options = args();
const command = options._[0];

if (command === 'chave') {
  if (existsSync(PRIVATE_KEY)) fail(`Ja existe uma chave em ${PRIVATE_KEY}. Nunca a substitua: as licencas emitidas deixariam de valer.`);
  mkdirSync(DATA, { recursive: true });
  const { privateKey: key, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(PRIVATE_KEY, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writePublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  console.log(`Chave criada em ${PRIVATE_KEY}.`);
  console.log(`Chave publica escrita em ${PUBLIC_KEY_TS} (recompile e publique o sistema).`);
  console.log('Faca ja uma copia protegida: node licencas/gerar-licenca.mjs exportar --ficheiro E:\\mavie-chave.pem --senha <senha>');
} else if (command === 'publica') {
  writePublicKey(createPublicKey(privateKey()).export({ type: 'spki', format: 'pem' }).toString());
  console.log(`Chave publica escrita em ${PUBLIC_KEY_TS}.`);
} else if (command === 'emitir') {
  const name = typeof options.nome === 'string' ? options.nome.trim() : '';
  const nuit = typeof options.nuit === 'string' ? options.nuit.trim() : '';
  if (!name) fail('Indique --nome "Nome comercial"');
  if (!/^\d{9}$/.test(nuit)) fail('Indique --nuit com 9 algarismos');
  const until = date(options.ate, '--ate');
  const issuedAt = new Date().toISOString().slice(0, 10);
  if (until < issuedAt) fail('A data --ate ja passou');
  const data = { id: randomUUID(), name, nuit, issuedAt, validUntil: until, v: 1 };
  const text = encode('MAVIE1', data, privateKey());
  registry({ type: 'licenca', ...data, motivo: typeof options.motivo === 'string' ? options.motivo : '' });
  console.log(`Licenca de ${name} (NUIT ${nuit}) valida ate ${until}:\n`);
  console.log(text);
  console.log('\nO cliente cola este texto em Configuracao > Sistema > Licenca > Ativar.');
} else if (command === 'desbloquear') {
  const request = typeof options.pedido === 'string' ? options.pedido.trim() : '';
  if (!/^\d{9}-\d{12}$/.test(request)) fail('Indique --pedido NUIT-AAAAMMDDHHmm (o que o sistema bloqueado mostra)');
  const days = Math.min(Math.max(Number(options.dias ?? 3), 1), 7);
  const issued = new Date();
  const valid = new Date(issued.getTime() + days * 86_400_000);
  const data = { id: randomUUID(), nuit: request.slice(0, 9), request, issuedAt: issued.toISOString().slice(0, 10), validUntil: valid.toISOString().slice(0, 10), v: 1 };
  const text = encode('MAVIER1', data, privateKey());
  registry({ type: 'desbloqueio', ...data, motivo: typeof options.motivo === 'string' ? options.motivo : '' });
  console.log(`Codigo de desbloqueio para ${request} (valido ate ${data.validUntil}, uma vez):\n`);
  console.log(text);
  console.log('\nConfirme primeiro com o cliente que a data e a hora do servidor estao certas.');
} else if (command === 'exportar') {
  const file = options.ficheiro;
  const password = options.senha;
  if (typeof file !== 'string' || typeof password !== 'string' || password.length < 8) fail('Indique --ficheiro e --senha (8 ou mais caracteres)');
  writeFileSync(file, privateKey().export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password }));
  console.log(`Copia cifrada da chave gravada em ${file}. Guarde-a fora deste computador.`);
} else if (command === 'importar') {
  const file = options.ficheiro;
  const password = options.senha;
  if (typeof file !== 'string' || typeof password !== 'string') fail('Indique --ficheiro e --senha');
  if (existsSync(PRIVATE_KEY)) fail(`Ja existe uma chave em ${PRIVATE_KEY}.`);
  const key = createPrivateKey({ key: readFileSync(file, 'utf8'), passphrase: password });
  mkdirSync(DATA, { recursive: true });
  writeFileSync(PRIVATE_KEY, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Chave reposta em ${PRIVATE_KEY}.`);
} else {
  console.log(`Gerador de licencas do MAVIE-HGest (so para o fabricante; nao vai no instalador)

  node licencas/gerar-licenca.mjs chave
  node licencas/gerar-licenca.mjs emitir --nome "Hotel X" --nuit 400123456 --ate 2026-12-31 [--motivo "Pago M-Pesa ..."]
  node licencas/gerar-licenca.mjs desbloquear --pedido 400123456-202612011030 [--dias 3] [--motivo "..."]
  node licencas/gerar-licenca.mjs exportar --ficheiro E:\\mavie-chave.pem --senha <senha>
  node licencas/gerar-licenca.mjs importar --ficheiro E:\\mavie-chave.pem --senha <senha>
  node licencas/gerar-licenca.mjs publica

Chave privada: ${PRIVATE_KEY}
Registo das licencas emitidas: ${REGISTRY}`);
}
