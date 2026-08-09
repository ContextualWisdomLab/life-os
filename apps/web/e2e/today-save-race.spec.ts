import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('preserves local edits made while an explicit workspace save is in flight', async ({
  page,
}) => {
  const revision = '22222222-2222-4222-8222-222222222222';
  let releaseSave: (() => void) | undefined;
  let markSaveStarted: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  const saveReleased = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });

  await page.route('**/api/planning/today/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Today aggregate was not found',
          status: 404,
          code: 'today_not_found',
        }),
      });
      return;
    }

    const submitted = request.postDataJSON() as {
      version: string;
      date: string;
      actions: unknown[];
    };
    markSaveStarted?.();
    await saveReleased;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { etag: `\"${revision}\"` },
      body: JSON.stringify({
        ...submitted,
        aggregateId: '44444444-4444-4444-8444-444444444444',
        revision,
      }),
    });
  });

  await page
    .getByLabel('Capture locally for Today')
    .fill('Submitted before save starts');
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Check workspace Today' }).click();

  await page
    .getByRole('button', { name: 'Move local draft to workspace' })
    .click();
  await saveStarted;

  await page
    .getByLabel('Capture locally for Today')
    .fill('Edited while save is pending');
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Edited while save is pending')).toBeVisible();

  releaseSave?.();

  await expect(
    page.getByText(
      'The current local Today is saved durably. Later local edits still require another explicit save.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Edited while save is pending')).toBeVisible();
  await expect(page.getByText('Submitted before save starts')).toBeVisible();
});
