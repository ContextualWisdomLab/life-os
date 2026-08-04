import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('captures, commits, schedules, persists, and completes an action', async ({
  page,
}) => {
  await page
    .getByLabel('Capture locally for Today')
    .fill('Review the release evidence');
  await page.getByRole('button', { name: 'Capture' }).click();

  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByText('Review the release evidence')).toBeVisible();
  await backlog.getByRole('button', { name: 'Make priority' }).click();

  await page.getByLabel('Start time for Review the release evidence').fill('09:00');
  await page
    .getByLabel('Duration for Review the release evidence')
    .selectOption('60');
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Review the release evidence')).toBeVisible();
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.getByRole('button', { name: 'Complete' }).click();
  const completed = page.getByRole('region', { name: 'Completed' });
  await expect(completed.getByText('Review the release evidence')).toBeVisible();
});

test('enforces the visible three-priority capacity', async ({ page }) => {
  for (const title of [
    'First priority',
    'Second priority',
    'Third priority',
    'Fourth action',
  ]) {
    await page.getByLabel('Capture locally for Today').fill(title);
    await page.getByRole('button', { name: 'Capture' }).click();
  }

  const backlog = page.getByRole('region', { name: 'Backlog' });
  const buttons = backlog.getByRole('button', { name: 'Make priority' });
  await buttons.nth(0).click();
  await buttons.nth(0).click();
  await buttons.nth(0).click();

  await expect(page.getByText('3 / 3')).toBeVisible();
  await expect(
    backlog.getByRole('button', { name: 'Make priority' }),
  ).toBeDisabled();
});

test('keeps core controls usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Make today believable.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Capture locally for Today')).toBeEditable();
  await expect(page.getByLabel('Search durable workspace')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
});
