import { expect, test } from '@playwright/test';

const EXISTING_ACTION_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';

async function clearBrowserState(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/onboarding');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function seedExistingPriority(
  page: Parameters<typeof test>[0]['page'],
): Promise<string> {
  return await page.evaluate((actionId) => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const draft = {
      version: 'life-os.today-draft.v1',
      date,
      actions: [
        {
          id: actionId,
          title: 'Review the existing launch evidence',
          status: 'open',
          priority: 1,
          startMinute: 9 * 60,
          durationMinutes: 60,
          createdAt: '2026-08-04T00:00:00.000Z',
          completedAt: null,
        },
      ],
    };
    const serialized = JSON.stringify(draft);
    window.localStorage.setItem('life-os.today-draft.v1', serialized);
    return serialized;
  }, EXISTING_ACTION_ID);
}

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test('guides an empty browser into one scheduled first priority', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole('heading', { name: 'Start with one believable day.' }),
  ).toBeVisible();

  await page
    .getByLabel('Weekly focus')
    .fill('Make the launch plan decision-ready');
  await page
    .getByLabel('First action')
    .fill('Draft the one-page launch brief');
  await page.getByLabel('Optional start time').fill('10:00');
  await page.getByLabel('Optional duration').selectOption('60');
  await page
    .getByRole('button', { name: 'Build my first Today plan' })
    .click();

  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { name: 'Make today believable.' }),
  ).toBeVisible();
  await expect(page.getByText('Draft the one-page launch brief')).toBeVisible();
  await expect(page.getByText('10:00–11:00')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Draft the one-page launch brief')).toBeVisible();
});

test('preserves existing Today actions and rejects an overlapping first block', async ({
  page,
}) => {
  const originalDraft = await seedExistingPriority(page);
  await page.reload();

  await page
    .getByLabel('Weekly focus')
    .fill('Protect the current launch commitment');
  await page.getByLabel('First action').fill('Prepare the stakeholder summary');
  await page.getByLabel('Optional start time').fill('09:30');
  await page
    .getByRole('button', { name: 'Build my first Today plan' })
    .click();

  await expect(
    page.getByText(
      'That time overlaps an existing open action. Choose another time or leave it unscheduled.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem('life-os.today-draft.v1'),
    ),
  ).toBe(originalDraft);

  await page.getByLabel('Optional start time').fill('10:00');
  await page
    .getByRole('button', { name: 'Build my first Today plan' })
    .click();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByText('Review the existing launch evidence'),
  ).toBeVisible();
  await expect(page.getByText('Prepare the stakeholder summary')).toBeVisible();
});

test('keeps first-run controls accessible on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Weekly focus')).toBeEditable();
  await expect(page.getByLabel('First action')).toBeEditable();
  await page.getByLabel('Weekly focus').pressSequentially('Plan the week');
  await page.getByLabel('First action').pressSequentially('Write the plan');
  await expect(
    page.getByRole('button', { name: 'Build my first Today plan' }),
  ).toBeEnabled();
});
