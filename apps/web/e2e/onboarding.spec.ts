import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/onboarding');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('creates a useful first plan without overwriting the Today contract', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', {
      name: 'Start with one believable commitment.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Local-first boundary')).toBeVisible();

  await page
    .getByLabel('What direction matters most right now?')
    .fill('Prepare a calm product launch');
  await page
    .getByLabel('What is the next visible action?')
    .fill('Review the release evidence');
  await page.getByLabel('Start time').fill('09:00');
  await page.getByLabel('Duration').selectOption('60');
  await page.getByRole('button', { name: 'Create my first plan' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByText('Review the release evidence')).toBeVisible();
  await expect(page.getByText('09:00–10:00')).toBeVisible();
  await expect(page.getByText('1 / 3')).toBeVisible();

  const storedCompletion = await page.evaluate(() =>
    window.localStorage.getItem('life-os.onboarding-completion.v1'),
  );
  expect(storedCompletion).toContain('life-os.onboarding-completion.v1');
});

test('fails closed when required planning inputs are absent', async ({ page }) => {
  await page.getByRole('button', { name: 'Create my first plan' }).click();
  await expect(
    page.getByText('Name a direction and one visible next action.'),
  ).toBeVisible();
  await expect(page).toHaveURL('/onboarding');
});

test('keeps the first-run controls usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', {
      name: 'Start with one believable commitment.',
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel('What direction matters most right now?'),
  ).toBeEditable();
  await expect(
    page.getByRole('button', { name: 'Create my first plan' }),
  ).toBeVisible();
});
