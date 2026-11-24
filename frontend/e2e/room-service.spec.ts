import { expect, test, type APIRequestContext } from '@playwright/test';
import { login, MANAGER } from './fixtures';

async function prepareStay(request: APIRequestContext) {
  const session = await request.post('/api/auth/login', { data: MANAGER, headers: { 'X-Forwarded-For': '10.9.9.9' } });
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const rooms = await (await request.get('/api/rooms', { headers })).json();
  const room = rooms.find((item: { number: string }) => item.number === '101');
  const register = await (await request.post('/api/cash-registers', { headers, data: { name: 'Caixa quartos' } })).json();
  await request.post(`/api/cash-registers/${register.id}/open`, { headers, data: { openingAmount: 0 } });
  const guest = await (await request.post('/api/guests', { headers, data: { firstName: 'Ana', lastName: 'Tablet' } })).json();
  const today = new Date();
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const reservation = await (await request.post('/api/reservations', { headers, data: { guestId: guest.id, roomId: room.id, checkIn: iso(today), checkOut: iso(tomorrow) } })).json();
  const checkIn = await request.post(`/api/reservations/${reservation.id}/check-in`, { headers });
  expect(checkIn.ok()).toBe(true);
}

test('o tablet do quarto pede ao restaurante, o POS aceita e entrega, e o valor vai para a conta do quarto', async ({ page, context, request }) => {
  await prepareStay(request);
  await login(page);
  await page.goto('/configuracao?tab=tablets');
  await page.getByRole('button', { name: 'Criar e gerar codigo' }).click();
  const code = (await page.getByTestId('pairing-code').first().textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);

  const tablet = await context.newPage();
  await tablet.setViewportSize({ width: 1280, height: 800 });
  await tablet.goto('/quarto');
  for (const digit of code) await tablet.getByRole('button', { name: digit, exact: true }).click();
  await tablet.getByRole('button', { name: 'Associar' }).click();
  await expect(tablet.getByRole('heading', { name: /Quarto 101/ })).toContainText('Ola, Ana');

  await tablet.getByRole('button', { name: /^Restaurante/ }).click();
  await tablet.getByRole('button', { name: 'Juntar Bitoque' }).click();
  await tablet.getByRole('button', { name: 'Juntar Bitoque' }).click();
  await expect(tablet.getByTestId('tablet-cart')).toContainText('Sera lancado na conta do quarto 101');
  await tablet.getByRole('button', { name: /^Enviar pedido/ }).click();
  await tablet.getByRole('dialog').getByRole('button', { name: /^Enviar pedido/ }).click();
  await expect(tablet.getByText('Pedido enviado')).toBeVisible();
  await expect(tablet.locator('article').first()).toContainText('2 × Bitoque');

  await page.goto('/pos');
  await expect(page.getByTestId('room-orders-badge')).toHaveText('1');
  await page.getByRole('tab', { name: /Pedidos dos quartos/ }).click();
  const card = page.getByTestId('room-orders').locator('article').first();
  await expect(card).toContainText('Quarto 101');
  await expect(card).toContainText('Ana Tablet');
  await card.getByRole('button', { name: 'Aceitar' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('PDF KITCHEN');
  await preview.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByText('Pedido aceite e enviado para preparacao')).toBeVisible();

  await page.getByTestId('room-orders').locator('article').first().getByRole('button', { name: 'Entregue' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Entregue' }).click();
  await expect(page.getByText('Entregue e lancado na conta do quarto')).toBeVisible();

  await tablet.reload();
  await tablet.getByRole('tab', { name: /Os meus pedidos/ }).click();
  await expect(tablet.locator('article').first().getByText('Entregue', { exact: true })).toHaveClass(/bg-indigo-600/);
  await expect(tablet.getByText(/Consumido nesta estadia/)).toContainText('24,00');
});
