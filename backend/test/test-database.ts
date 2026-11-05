import { config } from 'dotenv';
import { resolve } from 'node:path';

const SQLSERVER_DATABASE = /(^|;)database=([^;]*)/i;

export function sqlServerDatabase(url: string) {
  return url.match(SQLSERVER_DATABASE)?.[2] ?? '';
}

export function withSqlServerDatabase(url: string, database: string) {
  return SQLSERVER_DATABASE.test(url) ? url.replace(SQLSERVER_DATABASE, `$1database=${database}`) : `${url};database=${database}`;
}

export function testDatabaseUrl() {
  config({ path: resolve(__dirname, '..', '.env'), quiet: true });
  const source = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!source) {
    throw new Error('Define DATABASE_URL ou TEST_DATABASE_URL no backend/.env');
  }
  if (source.startsWith('sqlserver:')) {
    const name = sqlServerDatabase(source);
    const url = process.env.TEST_DATABASE_URL ? source : withSqlServerDatabase(source, `${name}_test`);
    if (!sqlServerDatabase(url).endsWith('_test')) {
      throw new Error(`Recusado: a base de dados de testes tem de terminar em _test (${sqlServerDatabase(url)})`);
    }
    return url;
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
