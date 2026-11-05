import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPrismaClient, isSqlServer } from '../src/prisma/database';
import { sqlServerDatabase, testDatabaseUrl, withSqlServerDatabase } from './test-database';

export default async function globalSetup() {
  const url = testDatabaseUrl();
  const sqlServer = isSqlServer(url);
  const name = sqlServer ? sqlServerDatabase(url) : new URL(url).pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(`Recusado: nome de base de dados de testes invalido (${name})`);
  }

  if (sqlServer) {
    const admin = createPrismaClient({ datasourceUrl: withSqlServerDatabase(url, 'master') });
    try {
      await admin.$executeRawUnsafe(`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`);
      await admin.$executeRawUnsafe(`CREATE DATABASE [${name}]`);
    } finally {
      await admin.$disconnect();
    }
  } else {
    const server = new URL(url);
    server.pathname = '/information_schema';
    const admin = createPrismaClient({ datasourceUrl: server.toString() });
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
    } finally {
      await admin.$disconnect();
    }
  }

  execSync(`npx prisma migrate deploy${sqlServer ? ' --schema prisma/sqlserver/schema.prisma' : ''}`, {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
