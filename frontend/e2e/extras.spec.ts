import { expect, test } from '@playwright/test';
import { login, MANAGER } from './fixtures';

test('o POS pede o acompanhamento obrigatorio e soma o preco da opcao', async ({ page, request }) => {
  const session = await request.post('/api/auth/login', { data: MANAGER, headers: { 'X-Forwarded-For': '10.9.9.8' } });
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const products = await (await request.get('/api/products', { headers })).json();
  const bitoque = products.find((item: { name: string }) => item.name === 'Bitoque');
  const created = await request.post('/api/products', {
    headers,
    data: { name: 'Hamburguer', price: 10, taxRateId: bitoque.taxRateId, categoryId: bitoque.categoryId, sellable: true },
  });
  expect(created.ok()).toBe(true);
  const burger = await created.json();

  await login(page);
  await page.goto('/produtos');
  await page.locator('tr', { hasText: 'Hamburguer' }).getByRole('button', { name: 'Opcoes' }).click();
  const editor = page.getByTestId('options-editor');
  await editor.getByRole('button', { name: '+ Grupo de opcoes' }).click();
  await editor.getByLabel('Grupo').fill('Acompanhamento');
  await editor.getByLabel('Opcao').nth(0).fill('Batata frita');
  await editor.getByLabel('Opcao').nth(1).fill('Salada');
  await editor.getByLabel('Acrescimo de preco').nth(1).fill('1.5');
  await editor.getByRole('button', { name: 'Guardar' }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('tr', { hasText: 'Hamburguer' }).getByRole('button', { name: 'Opcoes (1)' })).toBeVisible();
  const saved = await (await request.get(`/api/products/${burger.id}/options`, { headers })).json();
  expect(saved[0].options).toHaveLength(2);

  await page.goto('/pos');
  await page.getByRole('button', { name: /^2\b/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Mesa 2' })).toBeVisible();
  await page.getByRole('button', { name: /Hamburguer/ }).click();
  const dialog = page.getByTestId('options-dialog');
  await expect(dialog).toContainText('Acompanhamento');
  await expect(dialog.getByRole('button', { name: /^Adicionar/ })).toBeDisabled();
  await dialog.getByRole('button', { name: /Salada/ }).click();
  await expect(dialog.getByRole('button', { name: /^Adicionar/ })).toContainText('11,50');
  await dialog.getByRole('button', { name: /^Adicionar/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Hamburguer (Salada)')).toBeVisible();
});

test('regista uma categoria e uma despesa e anula-a com motivo', async ({ page }) => {
  await login(page);
  await page.goto('/despesas');
  await page.getByPlaceholder('Nova categoria').fill('Manutencao');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByText('Categoria criada')).toBeVisible();

  const form = page.getByTestId('expense-form');
  await form.getByLabel('Categoria').selectOption({ label: 'Manutencao' });
  await form.getByLabel('Descricao').fill('Lampadas do corredor');
  await form.getByLabel('Valor').fill('35');
  await form.getByRole('button', { name: 'Registar despesa' }).click();
  await expect(page.getByText('Despesa registada')).toBeVisible();
  const row = page.locator('tr', { hasText: 'Lampadas do corredor' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Anular' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Lancada em duplicado');
  await dialog.getByRole('button', { name: 'Anular' }).click();
  await expect(page.locator('tr', { hasText: 'Lampadas do corredor' })).toContainText('Lancada em duplicado');
});
