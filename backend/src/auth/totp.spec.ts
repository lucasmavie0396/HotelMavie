import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateSecret, hashRecoveryCode, totpCode, verifyTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it('reproduz os vetores de teste do RFC 6238 (SHA1, 6 digitos)', () => {
    expect(totpCode(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(rfcSecret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCode(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('aceita o passo anterior e o seguinte mas nao repete um codigo ja usado', () => {
    const secret = generateSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, 'abc123', null, now)).toBeNull();
  });

  it('codifica base32 ida e volta e cifra o segredo com autenticacao', () => {
    const bytes = Buffer.from('ola mundo 2fa');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    const secret = generateSecret();
    const stored = encryptSecret(secret, 'chave');
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, 'chave')).toBe(secret);
    expect(() => decryptSecret(stored, 'outra')).toThrow();
    expect(hashRecoveryCode('abcde-12345')).toBe(hashRecoveryCode('ABCDE12345'));
  });
});
