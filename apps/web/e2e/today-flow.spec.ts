import { expect, test } from '@playwright/test';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('captures, commits, schedules, persists, and completes an action', async ({
  page,
}) => {
  await page.getByLabel('What needs your attention?').fill('Review the release evidence');
  await page.getByRole('button', { name: 'Capture' }).click();

  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByText('Review the release evidence')).toBeVisible();
  await backlog.getByRole('button', { name: 'Make priority' }).click();

  await page.getByLabel('Start time for Review the release evidence').fill('09:00');
  await page.getByLabel('Duration for Review the release evidence').selectOption('60');
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Review the release evidence')).toBeVisible();
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.getByRole('button', { name: 'Complete' }).click();
  const completed = page.getByRole('region', { name: 'Completed' });
  await expect(completed.getByText('Review the release evidence')).toBeVisible();
});

test('enforces the visible three-priority capacity', async ({ page }) => {
  for (const title of ['First priority', 'Second priority', 'Third priority', 'Fourth action']) {
    await page.getByLabel('What needs your attention?').fill(title);
    await page.getByRole('button', { name: 'Capture' }).click();
  }

  const backlog = page.getByRole('region', { name: 'Backlog' });
  const buttons = backlog.getByRole('button', { name: 'Make priority' });
  await buttons.nth(0).click();
  await buttons.nth(0).click();
  await buttons.nth(0).click();

  await expect(page.getByText('3 / 3')).toBeVisible();
  await expect(backlog.getByRole('button', { name: 'Make priority' })).toBeDisabled();
});

test('keeps a local Today private until the user explicitly migrates it', async ({
  page,
}) => {
  let requestCount = 0;
  let putCount = 0;
  const revision = '22222222-2222-4222-8222-222222222222';

  await page.route('**/api/planning/today/**', async (route) => {
    requestCount += 1;
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

    expect(request.method()).toBe('PUT');
    putCount += 1;
    const requestHeaders = request.headers();
    expect(requestHeaders['if-none-match']).toBe('*');
    expect(requestHeaders['if-match']).toBeUndefined();
    expect(requestHeaders['idempotency-key']).toMatch(UUID_V4_PATTERN);

    const document = request.postDataJSON() as {
      version: string;
      date: string;
      actions: unknown[];
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { etag: `"${revision}"` },
      body: JSON.stringify({
        ...document,
        aggregateId: '44444444-4444-4444-8444-444444444444',
        revision,
      }),
    });
  });

  await page.reload();
  await expect(page.getByText('This Today is browser-local only.')).toBeVisible();
  expect(requestCount).toBe(0);

  await page.getByLabel('What needs your attention?').fill('Keep this local first');
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Keep this local first')).toBeVisible();
  expect(requestCount).toBe(0);

  await page.getByRole('button', { name: 'Check workspace Today' }).click();
  await expect(
    page.getByText(
      'No durable Today exists for this date. Your local draft is still unchanged.',
    ),
  ).toBeVisible();
  expect(requestCount).toBe(1);

  await page.getByRole('button', { name: 'Move local draft to workspace' }).click();
  await expect(
    page.getByText(
      'The current local Today is saved durably. Later local edits still require another explicit save.',
    ),
  ).toBeVisible();
  expect(requestCount).toBe(2);
  expect(putCount).toBe(1);
});

test('keeps core controls usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Make today believable.' })).toBeVisible();
  await expect(page.getByLabel('What needs your attention?')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
});
