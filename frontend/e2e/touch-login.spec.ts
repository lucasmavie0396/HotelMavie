import { expect, test } from '@playwright/test';
import { distinctAddress } from './fixtures';

test('login do ecra tactil: escolhe o utilizador e entra com o codigo', async ({ page }) => {
  await distinctAddress(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Ecra tactil (entrar com codigo)' }).click();
  await expect(page.getByRole('heading', { name: 'Quem vai entrar?' })).toBeVisible();
  await page.getByRole('button', { name: /Caixa Interface/ }).click();
  await expect(page.getByText('Introduza o seu codigo')).toBeVisible();

  for (const digit of '1111') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Codigo errado');

  for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/);

  await page.evaluate(() => localStorage.removeItem('mavie-hgest-session'));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Quem vai entrar?' })).toBeVisible();
});
