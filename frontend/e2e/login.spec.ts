import { expect, test } from '@playwright/test';
import { distinctAddress, login, MANAGER } from './fixtures';

test('recusa password errada e entra com a certa', async ({ page }) => {
  await distinctAddress(page);
  await page.goto('/stocks');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('Email').fill(MANAGER.email);
  await page.getByLabel('Password').fill('errada-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('form p.text-rose-600')).toBeVisible();

  await page.getByLabel('Password').fill(MANAGER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/stocks$/);
  await expect(page.getByRole('heading', { name: 'Stocks' })).toBeVisible();
});

test('o menu leva as paginas principais', async ({ page }) => {
  await login(page);
  for (const [link, heading] of [
    ['Reservas', 'Reservas'],
    ['Restaurante / Bar', 'Ponto de venda'],
    ['Compras', 'Compras'],
    ['Relatorios', 'Relatorios'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});
