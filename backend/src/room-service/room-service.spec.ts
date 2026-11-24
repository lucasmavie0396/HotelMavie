import { hoursOpen } from './room-service.service';

describe('horario do servico de quartos', () => {
  it('sem horario esta sempre aberto', () => {
    expect(hoursOpen(null, '03:00')).toBe(true);
  });

  it('horario no mesmo dia', () => {
    expect(hoursOpen('11:00-23:00', '10:59')).toBe(false);
    expect(hoursOpen('11:00-23:00', '11:00')).toBe(true);
    expect(hoursOpen('11:00-23:00', '23:00')).toBe(false);
  });

  it('horario que passa a meia-noite', () => {
    expect(hoursOpen('18:00-02:00', '23:30')).toBe(true);
    expect(hoursOpen('18:00-02:00', '01:59')).toBe(true);
    expect(hoursOpen('18:00-02:00', '02:00')).toBe(false);
    expect(hoursOpen('18:00-02:00', '12:00')).toBe(false);
  });
});
