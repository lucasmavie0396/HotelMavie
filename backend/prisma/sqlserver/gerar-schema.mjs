import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'schema.prisma');
const target = join(here, 'schema.prisma');
const prismaCli = join(here, '..', '..', 'node_modules', 'prisma', 'build', 'index.js');
const ENUM_LENGTH = 40;

function convert(text) {
  const enums = new Set();
  let result = text.replace(/^enum (\w+) \{[\s\S]*?^\}\n*/gm, (_, name) => {
    enums.add(name);
    return '';
  });
  result = result
    .replace(/generator client \{[\s\S]*?\}/, 'generator client {\n  provider = "prisma-client-js"\n  output   = "../../node_modules/.prisma/client-sqlserver"\n}')
    .replace(/provider = "mysql"/, 'provider = "sqlserver"');

  return result
    .split('\n')
    .map((line) => {
      const field = line.match(/^(\s+)(\w+)(\s+)(\w+)(\?|\[\])?(\s*)(.*)$/);
      if (!field || line.trim().startsWith('@@')) return line;
      const [, indent, name, gap, type, modifier = '', space, rest] = field;
      let attributes = rest;
      let newType = type;
      if (enums.has(type)) {
        if (modifier === '[]') throw new Error(`Lista de enum nao suportada em SQL Server: ${name}`);
        newType = 'String';
        attributes = attributes.replace(/@default\((\w+)\)/, '@default("$1")');
        attributes = `${attributes} @db.NVarChar(${ENUM_LENGTH})`.trim();
      } else if (type === 'Json') {
        newType = 'String';
        attributes = `${attributes} @db.NVarChar(Max)`.trim();
      }
      attributes = attributes.replace(/@db\.VarChar\((\d+)\)/g, '@db.NVarChar($1)').replace(/@db\.Text\b/g, '@db.NVarChar(Max)');
      if (/@relation\([^)]*fields:/.test(attributes) && !/onUpdate:/.test(attributes)) {
        attributes = attributes.replace(/@relation\(([^)]*)\)/, '@relation($1, onUpdate: NoAction)');
      }
      const typed = `${newType}${modifier}`;
      const padding = typed.length < type.length + modifier.length ? ' '.repeat(type.length + modifier.length - typed.length) : '';
      return `${indent}${name}${gap}${typed}${padding}${space || (attributes ? ' ' : '')}${attributes}`.trimEnd();
    })
    .join('\n');
}

function validate(file) {
  try {
    execFileSync(process.execPath, [prismaCli, 'validate', '--schema', file], {
      env: { ...process.env, DATABASE_URL: 'sqlserver://localhost:1433;database=validar', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: 'pipe',
    });
    return [];
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
    const groups = new Map();
    for (const block of output.split(/^error: /m).slice(1)) {
      const line = block.match(/schema\.prisma:(\d+)/);
      if (!line) continue;
      const message = block.split('\n')[0];
      groups.set(message, [...(groups.get(message) ?? []), Number(line[1])]);
    }
    if (!groups.size) throw new Error(output);
    return [...groups.values()];
  }
}

function model(rows, number) {
  for (let index = number - 1; index >= 0; index--) {
    const match = rows[index].match(/^model (\w+)/);
    if (match) return match[1];
  }
  return '?';
}

function withoutCascade(row) {
  return /onDelete:/.test(row) ? row.replace(/onDelete: \w+/, 'onDelete: NoAction') : row.replace(/@relation\(/, '@relation(onDelete: NoAction, ');
}

let schema = convert(readFileSync(source, 'utf8'));
const downgraded = [];
for (let round = 0; round < 40; round++) {
  writeFileSync(target, schema);
  const groups = validate(target);
  if (!groups.length) break;
  const rows = schema.split('\n');
  let changed = false;
  for (const lines of groups) {
    const open = lines.filter((number) => /@relation\(/.test(rows[number - 1]) && !/onDelete: NoAction/.test(rows[number - 1]));
    const number = open.find((candidate) => /\s+Hotel\??\s+@relation/.test(rows[candidate - 1])) ?? open[0];
    if (!number) continue;
    rows[number - 1] = withoutCascade(rows[number - 1]);
    downgraded.push(`${model(rows, number)}.${rows[number - 1].trim().split(/\s+/)[0]}`);
    changed = true;
  }
  if (!changed) throw new Error(`Nao foi possivel corrigir o schema: ${JSON.stringify(groups)}`);
  schema = rows.join('\n');
}
writeFileSync(target, schema);
if (validate(target).length) throw new Error('O schema gerado para SQL Server continua invalido');
console.log(`prisma/sqlserver/schema.prisma gerado. Relacoes sem cascata em SQL Server: ${downgraded.length ? downgraded.join(', ') : 'nenhuma'}`);
