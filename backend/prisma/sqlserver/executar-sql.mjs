import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('.prisma/client-sqlserver');

const url = process.env.MAVIE_SQL_URL;
const sql = process.env.MAVIE_SQL;
const query = process.argv.includes('--consulta');

if (!url?.startsWith('sqlserver:') || !sql) {
  console.error('Define MAVIE_SQL_URL (sqlserver://...) e MAVIE_SQL.');
  process.exit(2);
}

const client = new PrismaClient({ datasourceUrl: url });
try {
  if (query) {
    const rows = await client.$queryRawUnsafe(sql);
    for (const row of rows) console.log(Object.values(row).map((value) => (value === null ? '' : String(value))).join('\t'));
  } else {
    await client.$executeRawUnsafe(sql);
  }
} catch (error) {
  const lines = String(error?.message ?? error).split('\n').map((line) => line.trim()).filter(Boolean);
  console.error(lines.slice(-2).join(' '));
  process.exitCode = 1;
} finally {
  await client.$disconnect();
}
