import { Prisma } from '@prisma/client';
import { localParts, printedHash, qrCodeContent, signatureMessage } from './at-format';

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

  it('gera o conteudo do QR code com bases e IVA por categoria', () => {
    const qr = qrCodeContent({
      issuerTaxId: '500100200',
      customerTaxId: null,
      type: 'INVOICE_RECEIPT',
      issuedAt: new Date('2026-03-10T10:00:00Z'),
      invoiceNo: 'FR 2026/3',
      atcud: 'AAJFJ4VC-3',
      lines: [
        { taxCategory: 'RED', netAmount: '113.21', taxAmount: '6.79' },
        { taxCategory: 'NOR', netAmount: '5.69', taxAmount: '1.31' },
        { taxCategory: 'ISE', netAmount: '2.00', taxAmount: '0' },
      ],
      taxTotal: '8.10',
      grossTotal: '129.00',
      signature: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      certificateNumber: '0',
    });
    expect(qr).toBe(
      'A:500100200*B:999999990*C:PT*D:FR*E:N*F:20260310*G:FR 2026/3*H:AAJFJ4VC-3*I1:PT*I2:2.00*I3:113.21*I4:6.79*I7:5.69*I8:1.31*N:8.10*O:129.00*Q:AKU4*R:0',
    );
  });
});
