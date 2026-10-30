import { expect, test } from '@playwright/test';
import { login } from './fixtures';

test('regista uma quebra por documento e atualiza o stock ao lancar', async ({ page }) => {
  await login(page);
  await page.goto('/stocks');
  const imperial = page.getByRole('row', { name: /Imperial/ });
  await expect(imperial).toContainText('30 un');

  await page.getByRole('button', { name: 'Nova quebra' }).click();
  await page.getByPlaceholder('Motivo da quebra').fill('Garrafas partidas');
  await page.getByLabel('Quantidade').first().fill('2');
  await page.getByRole('button', { name: 'Guardar e lancar' }).click();

  const year = new Date().getFullYear();
  const row = page.getByRole('row', { name: new RegExp(`QB ${year}/1`) });
  await expect(row).toContainText('Lancado');
  await expect(row).toContainText('Garrafas partidas');

  await page.getByRole('button', { name: 'Existencias' }).click();
  await expect(imperial).toContainText('28 un');
  await imperial.getByRole('button', { name: 'Historico' }).click();
  await expect(page.getByText(`QB ${year}/1`).first()).toBeVisible();
});

test('sugere encomenda para o que esta abaixo do minimo e cria o rascunho', async ({ page }) => {
  await login(page);
  await page.goto('/compras');
  await page.getByRole('button', { name: 'Sugestoes de encomenda' }).click();
  const suggestion = page.getByRole('row', { name: /Imperial/ });
  await expect(suggestion).toBeVisible();
  await page.getByRole('button', { name: 'Criar rascunhos por fornecedor' }).click();
  await expect(page.getByText('1 rascunho(s) de compra criados')).toBeVisible();
  await expect(page.getByRole('row', { name: /Fornecedor Interface/ }).first()).toContainText('Rascunho');
});
