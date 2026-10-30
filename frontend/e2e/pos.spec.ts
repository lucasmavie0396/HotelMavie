import { expect, test } from '@playwright/test';
import { login } from './fixtures';

test('abre mesa, envia para a cozinha, divide a conta e marca o prato como pronto', async ({ page }) => {
  await login(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: /^1\b/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Mesa 1' })).toBeVisible();

  await page.getByRole('button', { name: /Bitoque/ }).click();
  await page.getByRole('button', { name: /Imperial/ }).click();
  await page.getByRole('button', { name: 'Enviar pedido (2)' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('1 de 2');
  await expect(preview).toContainText('PDF KITCHEN');
  await preview.getByRole('button', { name: 'Documento seguinte' }).click();
  await expect(preview).toContainText('PDF BAR');
  await preview.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByText('Pedido enviado')).toBeVisible();

  await page.getByRole('button', { name: 'Dividir / transferir artigos' }).click();
  await page.getByLabel('Mover Imperial').check();
  await page.getByRole('button', { name: 'Mover 1 linha(s)' }).click();
  await expect(page.getByRole('button', { name: /Conta 2/ })).toBeVisible();

  await page.goto('/cozinha');
  const card = page.locator('article', { hasText: 'Mesa 1' });
  await expect(card).toContainText('Bitoque');
  await card.getByRole('button', { name: 'Pronto' }).click();
  await expect(page.getByText('Sem pedidos em preparacao')).toBeVisible();

  await page.getByRole('button', { name: 'Bar' }).click();
  await expect(page.locator('article', { hasText: 'Mesa 1 (conta 2)' })).toContainText('Imperial');
});
