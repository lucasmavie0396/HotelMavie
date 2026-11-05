import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', 'prisma');

function models(text: string) {
  const result = new Map<string, string[]>();
  for (const block of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = block[2]
      .split('\n')
      .map((line) => line.match(/^\s+(\w+)\s+\w/)?.[1])
      .filter((name): name is string => !!name);
    result.set(block[1], fields.sort());
  }
  return result;
}

describe('schema SQL Server gerado a partir do MySQL', () => {
  it('tem os mesmos modelos e campos que o schema principal', () => {
    const mysql = models(readFileSync(join(root, 'schema.prisma'), 'utf8'));
    const sqlServer = models(readFileSync(join(root, 'sqlserver', 'schema.prisma'), 'utf8'));
    expect([...sqlServer.keys()].sort()).toEqual([...mysql.keys()].sort());
    for (const [name, fields] of mysql) expect({ name, fields: sqlServer.get(name) }).toEqual({ name, fields });
  });

  it('a ultima migracao SQL Server corresponde ao schema gerado', () => {
    const schema = readFileSync(join(root, 'sqlserver', 'schema.prisma'), 'utf8');
    const base = readFileSync(join(root, 'sqlserver', 'base.prisma'), 'utf8');
    expect(base).toBe(schema);
  });
});
