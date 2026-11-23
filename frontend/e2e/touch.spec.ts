import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures';

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mavie.ecra', JSON.stringify({ touch: true, scale: 100 }));
    localStorage.setItem('mavie.teclado', 'always');
  });
});

async function fitsWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function tall(locator: Locator, minimum = 44) {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minimum);
}

test('restaurante a 1024x768 com toque: mesas, produtos, quantidades, nota e teclado no ecra', async ({ page }) => {
  await login(page);
  await page.goto('/pos');
  await fitsWidth(page);
  expect((await page.locator('aside').first().boundingBox())?.width ?? 999).toBeLessThan(80);

  await expect(page.getByRole('tab', { name: 'Mesas' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('pos-tables').getByRole('button', { name: /^3\b/ }).click();
  await expect(page.getByRole('heading', { name: 'Mesa 3' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Produtos' })).toHaveAttribute('aria-selected', 'true');

  const grid = page.getByTestId('pos-products').locator('div.grid').first();
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBeGreaterThanOrEqual(3);

  const bitoque = page.getByTestId('pos-products').getByRole('button', { name: /Bitoque/ });
  await tall(bitoque);
  await bitoque.click();
  await bitoque.click();
  const order = page.getByTestId('pos-order');
  await expect(order.locator('li')).toHaveCount(1);
  await expect(order.locator('li').first()).toContainText('2');
  await order.getByRole('button', { name: 'Aumentar Bitoque' }).click();
  await expect(order.locator('li').first().locator('span.tabular-nums').last()).toHaveText('3');
  await tall(order.getByRole('button', { name: 'Diminuir Bitoque' }));
  await order.getByRole('button', { name: 'Diminuir Bitoque' }).click();
  await expect(order.locator('li').first().locator('span.tabular-nums').last()).toHaveText('2');
  await tall(order.getByRole('button', { name: /Enviar pedido/ }));

  await order.getByRole('button', { name: 'nota' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nota do artigo' });
  await expect(dialog).toBeVisible();
  const keyboard = page.getByRole('group', { name: 'Teclado no ecra' });
  await expect(keyboard).toBeVisible();
  for (const key of ['s', 'e', 'm']) await keyboard.getByRole('button', { name: key, exact: true }).click();
  await expect(dialog.locator('textarea')).toHaveValue('sem');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(order.getByText('> sem')).toBeVisible();

  await order.getByRole('button', { name: 'Fechar conta' }).click();
  await order.getByLabel('Valor').click();
  await expect(keyboard.getByRole('button', { name: '00', exact: true })).toBeVisible();
  await keyboard.getByRole('button', { name: 'Apagar' }).click();
  await order.getByRole('button', { name: 'Valor exato' }).click();
  await expect(order.getByText(/Pago .* de /)).toHaveClass(/text-emerald-700/);
  await fitsWidth(page);
  await order.getByRole('button', { name: 'Voltar' }).click();

  await order.getByRole('button', { name: 'Anular pedido' }).click();
  const confirm = page.getByRole('dialog', { name: 'Anular pedido' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('heading', { name: 'Mesa 3' })).toBeVisible();
});

test('cozinha e caixa cabem em 1024x768 e usam o teclado numerico', async ({ page }) => {
  await login(page);
  await page.goto('/cozinha');
  await fitsWidth(page);
  await tall(page.getByRole('button', { name: 'Bar', exact: true }));

  await page.goto('/caixa');
  await fitsWidth(page);
  await page.getByLabel('Nova caixa').fill('Caixa Toque');
  await page.getByRole('button', { name: 'Criar' }).click();
  const float = page.locator('.card', { hasText: 'Caixa Toque' }).getByPlaceholder('Fundo de caixa');
  await float.click();
  const keyboard = page.getByRole('group', { name: 'Teclado no ecra' });
  await expect(keyboard.getByRole('button', { name: '00', exact: true })).toBeVisible();
  for (const key of ['5', '0']) await keyboard.getByRole('button', { name: key, exact: true }).click();
  await keyboard.getByRole('button', { name: 'Virgula decimal' }).click();
  await keyboard.getByRole('button', { name: '5', exact: true }).click();
  await expect(float).toHaveValue('50.5');
});
