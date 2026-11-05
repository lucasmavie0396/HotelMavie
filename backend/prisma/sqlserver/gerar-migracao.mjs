import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schema = join(here, 'schema.prisma');
const base = join(here, 'base.prisma');
const migrations = join(here, 'migrations');
const prismaCli = join(here, '..', '..', 'node_modules', 'prisma', 'build', 'index.js');
const name = (process.argv[2] ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

if (!name) {
  console.error('Uso: node prisma/sqlserver/gerar-migracao.mjs <nome_da_migracao>');
  process.exit(1);
}

execFileSync(process.execPath, [join(here, 'gerar-schema.mjs')], { stdio: 'inherit' });

function nullableColumns(text) {
  const tables = new Map();
  for (const block of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = block[2];
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? block[1];
    const nullable = new Set();
    for (const line of body.split('\n')) {
      const field = line.match(/^\s+(\w+)\s+\w+\?/);
      if (field) nullable.add(line.match(/@map\("([^"]+)"\)/)?.[1] ?? field[1]);
    }
    tables.set(table, nullable);
  }
  return tables;
}

function filterNullableUniques(sql, tables) {
  const indexes = [];
  const unique = (table, constraint, columns) => {
    const list = columns.split(',').map((column) => column.trim().replace(/^\[|\]$/g, ''));
    const nullable = list.filter((column) => tables.get(table)?.has(column));
    if (!nullable.length) return null;
    const where = nullable.map((column) => `[${column}] IS NOT NULL`).join(' AND ');
    return `CREATE UNIQUE NONCLUSTERED INDEX [${constraint}] ON [dbo].[${table}](${columns}) WHERE ${where};`;
  };

  let result = sql.replace(/CREATE TABLE \[dbo\]\.\[(\w+)\] \(([\s\S]*?)\n\);/g, (statement, table, body) => {
    const lines = body.split('\n');
    const kept = [];
    for (const line of lines) {
      const match = line.match(/^\s*CONSTRAINT \[(\w+)\] UNIQUE NONCLUSTERED \(([^)]+)\),?$/);
      const index = match && unique(table, match[1], match[2]);
      if (index) indexes.push(index);
      else kept.push(line);
    }
    kept[kept.length - 1] = kept[kept.length - 1].replace(/,$/, '');
    return `CREATE TABLE [dbo].[${table}] (${kept.join('\n')}\n);`;
  });

  result = result.replace(/ALTER TABLE \[dbo\]\.\[(\w+)\] ADD CONSTRAINT \[(\w+)\] UNIQUE NONCLUSTERED \(([^)]+)\);/g, (statement, table, constraint, columns) => {
    return unique(table, constraint, columns) ?? statement;
  });

  if (!indexes.length) return result;
  const marker = result.lastIndexOf('COMMIT TRAN;');
  const block = `-- CreateIndex (unicos que aceitam varios NULL, como no MySQL)\n${indexes.join('\n')}\n\n`;
  return marker >= 0 ? `${result.slice(0, marker)}${block}${result.slice(marker)}` : `${result}\n${block}`;
}

const from = existsSync(base) ? ['--from-schema-datamodel', base] : ['--from-empty'];
const sql = execFileSync(process.execPath, [prismaCli, 'migrate', 'diff', ...from, '--to-schema-datamodel', schema, '--script'], {
  env: { ...process.env, DATABASE_URL: 'sqlserver://localhost:1433;database=gerar', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  encoding: 'utf8',
});

if (!/CREATE|ALTER|DROP|EXEC/.test(sql)) {
  console.log('Sem alteracoes no schema: nenhuma migracao criada.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const folder = join(migrations, `${stamp}_${name}`);
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'migration.sql'), filterNullableUniques(sql, nullableColumns(readFileSync(schema, 'utf8'))));
copyFileSync(schema, base);
console.log(`Migracao criada: prisma/sqlserver/migrations/${stamp}_${name}/migration.sql`);
