import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requestLang, translateMessage } from './i18n';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('traducao das mensagens da API', () => {
  it('todas as mensagens fixas de erro tem traducao para ingles', () => {
    const messages = new Set<string>();
    for (const file of sources(join(__dirname, '..'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/Exception\(\s*'([^']+)'/g)) messages.add(match[1]);
      for (const match of readFileSync(file, 'utf8').matchAll(/Exception\([^'\n]*\? '([^']+)' : '([^']+)'\)/g)) {
        messages.add(match[1]);
        messages.add(match[2]);
      }
    }
    const missing = [...messages].filter((message) => translateMessage(message, 'en') === message);
    expect(missing).toEqual([]);
    expect(messages.size).toBeGreaterThan(150);
  });

  it('traduz mensagens com valores e mantem o portugues por omissao', () => {
    expect(translateMessage('So ha 3 de Cerveja em Economato', 'en')).toBe('Only 3 of Cerveja at Economato');
    expect(translateMessage('So ha 3 em stock em Bar', 'en')).toBe('Only 3 in stock at Bar');
    expect(translateMessage('O quarto 101 nao esta pronto (CLEANING)', 'en')).toBe('Room 101 is not ready (CLEANING)');
    expect(translateMessage('Os pagamentos (15.00) tem de igualar o total (20.00)', 'en')).toBe('Payments (15.00) must equal the total (20.00)');
    expect(translateMessage('Credenciais invalidas', 'pt')).toBe('Credenciais invalidas');
    expect(requestLang({ headers: { 'x-lang': 'en' } })).toBe('en');
    expect(requestLang({ headers: {} })).toBe('pt');
  });
});
