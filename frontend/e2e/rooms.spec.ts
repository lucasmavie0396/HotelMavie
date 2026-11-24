import { expect, test } from '@playwright/test';
import { login } from './fixtures';

test('o gestor edita o quarto: tipo, preco e IVA proprio', async ({ page }) => {
  await login(page);
  await page.goto('/quartos');
  const row = page.getByRole('row', { name: /^101\b/ });
  await expect(row).toContainText('Taxa do hotel Alojamento (6%)');

  await row.getByRole('button', { name: 'Editar' }).click();
  const form = page.locator('form[data-testid^="room-edit-"]');
  await form.getByLabel('Tipo').fill('Standard Vista Mar');
  await form.getByLabel('Preco/noite').fill('95');
  await form.getByLabel('IVA').selectOption({ label: 'Normal (23%)' });
  await form.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText('Quarto 101 guardado')).toBeVisible();
  const saved = page.getByRole('row', { name: /^101\b/ });
  await expect(saved).toContainText('Standard Vista Mar');
  await expect(saved).toContainText('95,00');
  await expect(saved).toContainText('Normal (23%)');
});
