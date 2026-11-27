import { expect, test } from '@playwright/test';
import { login, MANAGER } from './fixtures';

test('faturacao como no LAMGest: cotacao, conversao, nota de credito parcial e recibo', async ({ page, request }) => {
  const session = await request.post('/api/auth/login', { data: MANAGER, headers: { 'X-Forwarded-For': '10.9.9.7' } });
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const register = await (await request.post('/api/cash-registers', { headers, data: { name: 'Caixa faturacao' } })).json();
  await request.post(`/api/cash-registers/${register.id}/open`, { headers, data: { openingAmount: 0 } });
  await login(page);
  await page.goto('/faturacao');
  await expect(page.getByTestId('documents-table')).toBeVisible();

  await page.getByTestId('new-quote').click();
  const form = page.getByTestId('document-form');
  await form.getByLabel('Cliente').fill('Empresa Interface');
  await form.getByLabel('NUIT').fill('400000009');
  await form.getByRole('button', { name: '+ Linha livre' }).click();
  await form.getByLabel('Descricao da linha 1').fill('Sala de eventos');
  await form.getByLabel('Quantidade da linha 1').fill('2');
  await form.getByLabel('Preco da linha 1').fill('500');
  const vat = form.getByLabel('IVA da linha 1');
  await vat.selectOption({ index: 1 });
  await expect(form).toContainText('Total previsto:');
  await form.getByRole('button', { name: 'Emitir cotacao' }).click();

  const detail = page.getByTestId('document-detail');
  await expect(detail.getByRole('heading', { name: /^Cotacao CT \d{4}\/\d+$/ })).toBeVisible();
  await expect(detail).toContainText('Sala de eventos');
  await detail.getByRole('button', { name: 'Converter em fatura' }).click();
  await expect(detail.getByLabel('Cliente *')).toHaveValue('Empresa Interface');
  await detail.getByRole('button', { name: 'Emitir fatura' }).click();

  await expect(detail.getByRole('heading', { name: /^Fatura FT \d{4}\/\d+$/ })).toBeVisible();
  await expect(detail).toContainText('Da cotacao');
  await detail.getByRole('button', { name: 'Nota de credito' }).click();
  await detail.getByLabel('Quantidade a creditar de Sala de eventos').fill('1');
  await detail.getByRole('button', { name: /^Creditar .*500/ }).click();
  await page.getByRole('dialog').last().locator('input').fill('Um dia cancelado');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(detail.getByRole('heading', { name: /^Nota de Credito NC \d{4}\/\d+$/i })).toBeVisible();
  await detail.getByRole('button', { name: /^FT \d{4}\/\d+$/ }).click();
  await expect(detail).toContainText('1 creditado(s)');

  await detail.getByRole('button', { name: 'Receber' }).click();
  const receipt = page.getByTestId('receipt-form');
  await expect(receipt).toContainText('Empresa Interface');
  await receipt.getByRole('button', { name: /^Emitir recibo/ }).click();
  await expect(detail.getByRole('heading', { name: /RG \d{4}\/\d+$/ })).toBeVisible();
  const preview = page.getByRole('dialog', { name: /PDF RECEIPT/ });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Fechar' }).click();
  await detail.getByRole('button', { name: 'Fechar' }).click();

  await page.getByTestId('only-unpaid').check();
  await expect(page.getByTestId('documents-table')).toContainText('Sem documentos');
  await page.getByTestId('only-unpaid').uncheck();
  const table = page.getByTestId('documents-table');
  await expect(table).toContainText('Convertida');
  await expect(table).toContainText('Liquidada');
});
