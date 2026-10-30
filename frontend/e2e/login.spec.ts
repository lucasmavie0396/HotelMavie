import { expect, test } from '@playwright/test';
import { distinctAddress, login, MANAGER } from './fixtures';

test('recusa password errada e entra com a certa', async ({ page }) => {
  await distinctAddress(page);
  await page.goto('/stocks');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('Email').fill(MANAGER.email);
  await page.getByLabel('Password').fill('errada-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('form p.text-rose-600')).toBeVisible();

  await page.getByLabel('Password').fill(MANAGER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/stocks$/);
  await expect(page.getByRole('heading', { name: 'Stocks' })).toBeVisible();
});

test('pede o link de recuperacao sem revelar se o email existe', async ({ page }) => {
  await distinctAddress(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Esqueci-me da password' }).click();
  await page.getByLabel('Email').fill('nao-existe@teste.local');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByText('Se o email existir, recebe uma mensagem')).toBeVisible();

  await page.goto('/repor-password?token=token-invalido-com-mais-de-vinte-caracteres');
  await page.getByLabel('Nova password').fill('Nova-Pass-2026');
  await page.getByLabel('Repetir password').fill('Nova-Pass-2026');
  await page.getByRole('button', { name: 'Guardar password' }).click();
  await expect(page.getByText('O link expirou ou ja foi usado')).toBeVisible();
});

test('a pagina da conta mostra o QR para ativar o 2FA', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Gestor Interface' }).click();
  await expect(page.getByText('Desativada')).toBeVisible();
  await page.getByRole('button', { name: 'Ativar 2FA' }).click();
  await expect(page.getByAltText('Codigo QR para a aplicacao autenticadora')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('o menu leva as paginas principais', async ({ page }) => {
  await login(page);
  for (const [link, heading] of [
    ['Reservas', 'Reservas'],
    ['Restaurante / Bar', 'Ponto de venda'],
    ['Compras', 'Compras'],
    ['Relatorios', 'Relatorios'],
    ['Auditoria', 'Auditoria'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});
