import { Hotel } from '@prisma/client';
import { bookingRequestEmail, escapeHtml } from './templates';

describe('templates de email', () => {
  it('escapa HTML de dados introduzidos por utilizadores', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'y\'')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });

  it('nao injeta o nome do hospede como HTML', () => {
    const hotel = { name: 'Hotel <b>', currency: 'EUR', address: null, phone: null, email: null } as Hotel;
    const { html } = bookingRequestEmail(hotel, {
      code: 'R1',
      guestName: '<img src=x onerror=alert(1)>',
      roomType: 'Suite',
      checkIn: '2026-01-01',
      checkOut: '2026-01-03',
      adults: 2,
      children: 0,
      totalAmount: 300,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Hotel &lt;b&gt;');
    expect(html).toContain('01/01/2026');
  });
});
