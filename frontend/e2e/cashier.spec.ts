import { expect, test } from '@playwright/test';
import { CASHIER, distinctAddress } from './fixtures';

test('o perfil caixa so ve o restaurante/bar e o caixa', async ({ page }) => {
  await distinctAddress(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(CASHIER.email);
  await page.getByLabel('Password').fill(CASHIER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole('heading', { name: 'Ponto de venda' })).toBeVisible();
  const menu = page.locator('aside nav a');
  await expect(menu).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Contas de quarto' })).toHaveCount(0);

  await page.goto('/reservas');
  await expect(page).toHaveURL(/\/pos$/);

  await page.getByRole('link', { name: 'Caixa', exact: true }).first().click();
  await expect(page).toHaveURL(/\/caixa$/);
});
