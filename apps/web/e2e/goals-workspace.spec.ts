import { expect, test } from '@playwright/test';

const freshGoal = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Fresh server goal',
  createdAt: '2026-09-02T02:00:00.000Z',
});

const staleGoal = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Stale server goal',
  createdAt: '2026-09-02T01:00:00.000Z',
});

test('keeps the newest Goals load when an older request finishes last', async ({
  page,
}) => {
  let requestCount = 0;
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await page.route('**/api/planning/goals', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405 });
      return;
    }

    requestCount += 1;
    if (requestCount === 1) {
      markFirstStarted?.();
      await firstReleased;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([staleGoal]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([freshGoal]),
    });
  });

  await page.goto('/goals');
  await firstStarted;
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByText(freshGoal.title)).toBeVisible();

  releaseFirst?.();

  await expect(page.getByText(freshGoal.title)).toBeVisible();
  await expect(page.getByText(staleGoal.title)).toHaveCount(0);
});

test('fails closed when the Goal projection contains a normalized invalid UTC date', async ({
  page,
}) => {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '55555555-5555-4555-8555-555555555555',
          title: 'Invalid timestamp evidence',
          createdAt: '2026-02-30T00:00:00.000Z',
        },
      ]),
    });
  });

  await page.goto('/goals');

  await expect(
    page.getByText('The Goals workspace is temporarily unavailable.'),
  ).toBeVisible();
  await expect(page.getByText('Invalid timestamp evidence')).toHaveCount(0);
});

test('keeps the LifeOS brand link at the minimum interactive target height', async ({
  page,
}) => {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.goto('/goals');

  const targetHeight = await page
    .getByRole('link', { name: 'LifeOS Today' })
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(targetHeight).toBeGreaterThanOrEqual(44);
});
