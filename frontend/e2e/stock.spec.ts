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

test('compra com desconto e IVA por linha, rececao exige documento e anulacao repoe o stock', async ({ page }) => {
  await login(page);
  await page.goto('/compras');
  await page.getByRole('button', { name: 'Nova compra' }).click();
  await page.getByLabel('Quantidade').fill('10');
  await page.getByLabel('Custo unit. s/ IVA').fill('2');
  await page.getByLabel('Desconto').fill('4');
  await expect(page.getByLabel('IVA %')).toHaveValue('23');
  await expect(page.getByText('19,68').first()).toBeVisible();
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();

  const row = page.getByRole('row', { name: /Fornecedor Interface/ }).filter({ hasText: '10 Imperial' });
  await expect(row).toContainText('Rascunho');
  await row.getByRole('button', { name: 'Receber' }).click();
  await page.getByLabel('N.o do documento do fornecedor (fatura ou guia)').fill('FT UI/1');
  await page.getByRole('button', { name: 'Dar entrada em stock' }).click();
  const received = page.getByRole('row', { name: /FT UI\/1/ });
  await expect(received).toContainText('Recebida');

  await received.getByRole('button', { name: 'Anular' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Fatura duplicada');
  await dialog.getByRole('button', { name: 'Anular' }).click();
  await expect(received).toContainText('Cancelada');
  await expect(received).toContainText('Anulada: Fatura duplicada');

  await page.goto('/stocks');
  await expect(page.getByRole('row', { name: /Imperial/ })).toContainText('28 un');
});

test('inventario abre com o saldo, mostra a diferenca e o ajuste exige motivo e stock', async ({ page }) => {
  await login(page);
  await page.goto('/stocks');
  await page.getByRole('button', { name: 'Novo inventario' }).click();
  const counted = page.getByLabel('Contado de Imperial');
  await expect(counted).toHaveValue('28');
  await counted.fill('25');
  await expect(page.getByText('1 produto(s) com diferenca')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar contagem' }).click();
  await expect(page.getByRole('button', { name: /Continuar inventario/ })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar inventario' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();

  const year = new Date().getFullYear();
  await expect(page.getByRole('row', { name: new RegExp(`INV ${year}/1`) })).toContainText('Lancado');
  await page.getByRole('button', { name: 'Existencias' }).click();
  const imperial = page.getByRole('row', { name: /Imperial/ });
  await expect(imperial).toContainText('25 un');

  await imperial.getByRole('button', { name: 'Ajustar' }).click();
  await page.getByLabel('Quantidade (+ entra, - sai)').fill('-40');
  await page.getByLabel('Motivo do ajuste').fill('Erro de contagem');
  await page.locator('form').getByRole('button', { name: 'Ajustar' }).click();
  await expect(page.getByText(/Stock insuficiente de Imperial/)).toBeVisible();
  await page.getByLabel('Quantidade (+ entra, - sai)').fill('5');
  await page.locator('form').getByRole('button', { name: 'Ajustar' }).click();
  await expect(imperial).toContainText('30 un');
});
