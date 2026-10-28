import { splitGross, sumMoney, toMoney } from './money';

describe('money', () => {
  it('separa base e IVA de um preco com IVA incluido', () => {
    expect(splitGross(120, 6)).toMatchObject({ netAmount: toMoney('113.21'), taxAmount: toMoney('6.79') });
    expect(splitGross(7, 23)).toMatchObject({ netAmount: toMoney('5.69'), taxAmount: toMoney('1.31') });
  });

  it('base mais IVA da sempre o valor bruto, sem perder centimos', () => {
    for (const gross of ['0.01', '0.99', '1.00', '9.99', '33.33', '100.00', '1234.56']) {
      for (const rate of [0, 6, 13, 14, 16, 23]) {
        const { netAmount, taxAmount, grossAmount } = splitGross(gross, rate);
        expect(netAmount.add(taxAmount).equals(grossAmount)).toBe(true);
        expect(netAmount.decimalPlaces()).toBeLessThanOrEqual(2);
      }
    }
  });

  it('com taxa 0 nao ha IVA', () => {
    expect(splitGross('50', 0).taxAmount.isZero()).toBe(true);
  });

  it('soma valores sem erros de virgula flutuante', () => {
    expect(sumMoney(['0.1', '0.2']).toString()).toBe('0.3');
    expect(sumMoney([]).toString()).toBe('0');
  });
});
