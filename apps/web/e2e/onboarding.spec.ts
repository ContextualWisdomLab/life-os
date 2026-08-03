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

test('restores the existing Today draft when completion storage fails', async ({
  page,
}) => {
  const existingDraft = await page.evaluate(() => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const value = JSON.stringify({
      version: 'life-os.today-draft.v1',
      date,
      actions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Protect the existing plan',
          status: 'open',
          priority: 1,
          startMinute: null,
          durationMinutes: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
    });
    window.localStorage.setItem('life-os.today-draft.v1', value);
    return value;
  });

  await page.addInitScript(() => {
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(
      key: string,
      value: string,
    ): void {
      if (key === 'life-os.onboarding-completion.v1') {
        throw new DOMException('Simulated storage failure', 'QuotaExceededError');
      }
      nativeSetItem.call(this, key, value);
    };
  });
  await page.reload();

  await page
    .getByLabel('What direction matters most right now?')
    .fill('Prepare a calm product launch');
  await page
    .getByLabel('What is the next visible action?')
    .fill('Review the release evidence');
  await page.getByRole('button', { name: 'Create my first plan' }).click();

  await expect(
    page.getByText(
      'Your browser could not save the complete plan safely. Your previous Today draft was restored.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL('/onboarding');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('life-os.today-draft.v1'),
      ),
    )
    .toBe(existingDraft);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('life-os.onboarding-completion.v1'),
      ),
    )
    .toBeNull();
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
