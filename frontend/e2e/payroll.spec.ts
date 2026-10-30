import { expect, test } from '@playwright/test';
import { login } from './fixtures';

test('processa os salarios do mes, mostra o recibo e fecha o mes', async ({ page }) => {
  await login(page);
  await page.goto('/rh');
  await page.getByRole('button', { name: 'Salarios' }).click();
  await page.getByLabel('Mes').fill('2026-03');
  await page.getByRole('button', { name: 'Processar salarios' }).click();

  const row = page.getByRole('row', { name: /Rita Costa/ });
  await expect(row).toContainText('900,00');
  await expect(row).toContainText('756,00');

  await row.getByRole('button', { name: 'Recibo' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('Recibo Rita Costa Marco 2026');
  await preview.getByRole('button', { name: 'Fechar' }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Fechar mes' }).click();
  await expect(page.getByText('Salarios fechados')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});
