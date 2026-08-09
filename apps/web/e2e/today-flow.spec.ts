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
  await page
    .getByLabel('Capture locally for Today')
    .fill('Review the release evidence');
  await page.getByRole('button', { name: 'Capture' }).click();

  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByText('Review the release evidence')).toBeVisible();
  await backlog.getByRole('button', { name: 'Make priority' }).click();

  await page
    .getByLabel('Start time for Review the release evidence')
    .fill('09:00');
  await page
    .getByLabel('Duration for Review the release evidence')
    .selectOption('60');
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Review the release evidence')).toBeVisible();
  await expect(page.getByText('09:00–10:00')).toBeVisible();

  await page.getByRole('button', { name: 'Complete' }).click();
  const completed = page.getByRole('region', { name: 'Completed' });
  await expect(
    completed.getByText('Review the release evidence'),
  ).toBeVisible();
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
  await expect(
    page.getByText('This Today is browser-local only.'),
  ).toBeVisible();
  expect(requestCount).toBe(0);

  await page
    .getByLabel('Capture locally for Today')
    .fill('Keep this local first');
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

  await page
    .getByRole('button', { name: 'Move local draft to workspace' })
    .click();
  await expect(
    page.getByText(
      'The current local Today is saved durably. Later local edits still require another explicit save.',
    ),
  ).toBeVisible();
  expect(requestCount).toBe(2);
  expect(putCount).toBe(1);
});

test('keeps the local draft after a failed save and retries only after another explicit check', async ({
  page,
}) => {
  let getCount = 0;
  let putCount = 0;
  const idempotencyKeys: string[] = [];
  const revision = '77777777-7777-4777-8777-777777777777';

  await page.route('**/api/planning/today/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      getCount += 1;
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
    const idempotencyKey = requestHeaders['idempotency-key'] ?? '';
    expect(idempotencyKey).toMatch(UUID_V4_PATTERN);
    idempotencyKeys.push(idempotencyKey);

    if (putCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Today synchronization is unavailable',
          status: 503,
          code: 'today_sync_unavailable',
        }),
      });
      return;
    }

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
        aggregateId: '88888888-8888-4888-8888-888888888888',
        revision,
      }),
    });
  });

  await page.reload();
  await page
    .getByLabel('Capture locally for Today')
    .fill('Survive a workspace outage');
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Check workspace Today' }).click();
  await page
    .getByRole('button', { name: 'Move local draft to workspace' })
    .click();

  await expect(
    page.getByText(
      'Workspace Today is temporarily unavailable. Your local draft remains unchanged.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Survive a workspace outage')).toBeVisible();
  expect(getCount).toBe(1);
  expect(putCount).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Move local draft to workspace' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Check workspace Today' }).click();
  await page
    .getByRole('button', { name: 'Move local draft to workspace' })
    .click();

  await expect(
    page.getByText(
      'The current local Today is saved durably. Later local edits still require another explicit save.',
    ),
  ).toBeVisible();
  expect(getCount).toBe(2);
  expect(putCount).toBe(2);
  expect(idempotencyKeys).toHaveLength(2);
  expect(idempotencyKeys[1]).not.toBe(idempotencyKeys[0]);
});

test('surfaces a stale-device conflict and requires an explicit recheck before using newer workspace state', async ({
  page,
}) => {
  const oldRevision = '22222222-2222-4222-8222-222222222222';
  const newRevision = '55555555-5555-4555-8555-555555555555';
  let getCount = 0;
  let putCount = 0;

  await page.route('**/api/planning/today/**', async (route) => {
    const request = route.request();
    const date = new URL(request.url()).pathname.split('/').at(-1) ?? '';
    if (request.method() === 'GET') {
      getCount += 1;
      const revision = getCount === 1 ? oldRevision : newRevision;
      const title =
        getCount === 1 ? 'Older workspace copy' : 'Newer device copy';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { etag: `"${revision}"` },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          aggregateId: '44444444-4444-4444-8444-444444444444',
          revision,
          date,
          actions: [
            {
              id: '66666666-6666-4666-8666-666666666666',
              title,
              status: 'open',
              priority: 1,
              startMinute: null,
              durationMinutes: null,
              createdAt: `${date}T00:00:00.000Z`,
              completedAt: null,
            },
          ],
        }),
      });
      return;
    }

    expect(request.method()).toBe('PUT');
    putCount += 1;
    const requestHeaders = request.headers();
    expect(requestHeaders['if-match']).toBe(`"${oldRevision}"`);
    expect(requestHeaders['if-none-match']).toBeUndefined();
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Today changed on another device',
        status: 409,
        code: 'today_revision_conflict',
        currentRevision: newRevision,
      }),
    });
  });

  await page.reload();
  await page
    .getByLabel('Capture locally for Today')
    .fill('Local conflicting edit');
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Local conflicting edit')).toBeVisible();

  await page.getByRole('button', { name: 'Check workspace Today' }).click();
  await expect(
    page.getByText(
      'A durable Today exists. Review your choice before replacing either copy.',
    ),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Replace workspace with this local draft' })
    .click();
  await expect(
    page.getByText(
      'Another device changed Today. Check the workspace again before deciding which copy to keep.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Local conflicting edit')).toBeVisible();
  expect(putCount).toBe(1);

  await page.getByRole('button', { name: 'Check workspace Today' }).click();
  await page
    .getByRole('button', { name: 'Use workspace Today in this browser' })
    .click();
  await expect(page.getByText('Newer device copy')).toBeVisible();
  await expect(page.getByText('Local conflicting edit')).toHaveCount(0);
  expect(getCount).toBe(2);
});

test('keeps core controls usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Make today believable.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Capture locally for Today')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
});
