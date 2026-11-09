import { Prisma } from '@prisma/client';
import { localParts, printedHash, signatureMessage } from './at-format';

describe('formatos AT', () => {
  it('usa a hora de Lisboa, incluindo a mudanca para a hora de verao', () => {
    expect(localParts(new Date('2026-01-15T23:30:00Z'))).toMatchObject({ date: '2026-01-15', dateTime: '2026-01-15T23:30:00' });
    expect(localParts(new Date('2026-07-15T23:30:00Z'))).toMatchObject({ date: '2026-07-16', dateTime: '2026-07-16T00:30:00' });
  });

  it('monta a mensagem a assinar no formato da AT', () => {
    const message = signatureMessage({
      issuedAt: new Date('2026-03-10T10:05:09Z'),
      invoiceNo: 'FT 2026/7',
      grossTotal: new Prisma.Decimal('123.4'),
      previousHash: 'abc',
    });
    expect(message).toBe('2026-03-10;2026-03-10T10:05:09;FT 2026/7;123.40;abc');
    expect(signatureMessage({ issuedAt: new Date('2026-03-10T10:05:09Z'), invoiceNo: 'FT 2026/1', grossTotal: new Prisma.Decimal(1), previousHash: null })).toMatch(/;1\.00;$/);
  });

  it('imprime os caracteres 1, 11, 21 e 31 da assinatura', () => {
    expect(printedHash('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toBe('AKU4');
  });
});
