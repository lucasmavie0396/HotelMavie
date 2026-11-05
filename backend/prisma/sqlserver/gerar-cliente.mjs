import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '..', '..', 'node_modules', '.prisma', 'client-sqlserver');
const prismaCli = join(here, '..', '..', 'node_modules', 'prisma', 'build', 'index.js');

execFileSync(process.execPath, [prismaCli, 'generate', '--schema', join(here, 'schema.prisma')], {
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL?.startsWith('sqlserver:') ? process.env.DATABASE_URL : 'sqlserver://localhost:1433;database=gerar', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  stdio: 'inherit',
});

for (const name of readdirSync(output)) {
  if (!/\.(c?js|mjs|d\.ts)$/.test(name)) continue;
  const file = join(output, name);
  const text = readFileSync(file, 'utf8');
  const shared = text.replace(/(['"])\.\/runtime\//g, '$1@prisma/client/runtime/');
  if (shared !== text) writeFileSync(file, shared);
}
rmSync(join(output, 'runtime'), { recursive: true, force: true });
console.log('Cliente Prisma para SQL Server gerado (runtime partilhado com @prisma/client).');
