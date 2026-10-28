import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { testDatabaseUrl } from './test-database';

export default async function globalSetup() {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(`Recusado: nome de base de dados de testes invalido (${name})`);
  }

  const server = new URL(url);
  server.pathname = '/information_schema';
  const admin = new PrismaClient({ datasourceUrl: server.toString() });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
