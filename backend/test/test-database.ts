import { config } from 'dotenv';
import { resolve } from 'node:path';

export function testDatabaseUrl() {
  config({ path: resolve(__dirname, '..', '.env'), quiet: true });
  const source = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!source) {
    throw new Error('Define DATABASE_URL ou TEST_DATABASE_URL no backend/.env');
  }
  const url = new URL(source);
  if (!process.env.TEST_DATABASE_URL) {
    url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  }
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Recusado: a base de dados de testes tem de terminar em _test (${url.pathname})`);
  }
  return url.toString();
}
