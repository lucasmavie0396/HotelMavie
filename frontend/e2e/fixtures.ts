import { expect, type Page } from '@playwright/test';

export const MANAGER = { email: 'gestor-ui@teste.local', password: 'Teste-UI-1234' };
export const CASHIER = { email: 'caixa-ui@teste.local', password: 'Teste-UI-1234' };

export async function distinctAddress(page: Page) {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${part()}.${part()}.${part()}` });
}

export async function login(page: Page) {
  await distinctAddress(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(MANAGER.email);
  await page.getByLabel('Password').fill(MANAGER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/$/);
}
