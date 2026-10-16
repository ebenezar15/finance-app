import { expect, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

test('makes no third-party network requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto('/');
  await expect(page.getByText('Safe to spend today')).toBeVisible({ timeout: 20_000 });
  for (const path of ['/activity', '/budgets', '/bills', '/goals', '/debts', '/wealth', '/insights', '/family', '/inbox', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(external).toEqual([]);
});

test('logs an expense in under 5 seconds', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Safe to spend today')).toBeVisible({ timeout: 20_000 });
  const t0 = Date.now();
  await page.keyboard.press('n');
  await page.keyboard.type('12.5');
  await page.getByRole('button', { name: /Groceries/ }).first().click();
  await page.getByRole('button', { name: /^Save \$/ }).click();
  await expect(page.getByText(/Saved \$12\.50/)).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(5000);
});

test('opens and works offline after first load', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Safe to spend today')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active);
  await page.reload(); // let the service worker take control
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Safe to spend today')).toBeVisible();
  await page.getByRole('link', { name: 'Budgets' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
