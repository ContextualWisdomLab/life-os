import { expect, test, type Page } from '@playwright/test';

const SEARCH_PATH = '**/api/planning/search**';

/** Starts each scenario from a deterministic browser-local Today draft. */
async function resetLocalDraft(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await resetLocalDraft(page);
});

test('keeps local capture distinct from durable workspace search', async ({
  page,
}) => {
  await page.route(SEARCH_PATH, async (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('q')).toBe('release evidence');
    expect(requestUrl.searchParams.get('limit')).toBe('20');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          entityType: 'goal',
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Release confidence',
          createdAt: '2026-08-04T01:00:00.000Z',
        },
        {
          entityType: 'project',
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Release evidence project',
          parentId: '11111111-1111-4111-8111-111111111111',
          createdAt: '2026-08-04T02:00:00.000Z',
        },
        {
          entityType: 'task',
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Review release evidence',
          parentId: '22222222-2222-4222-8222-222222222222',
          status: 'todo',
          createdAt: '2026-08-04T03:00:00.000Z',
        },
      ]),
    });
  });

  await page
    .getByLabel('Capture locally for Today')
    .fill('Write a local release note');
  await page.getByRole('button', { name: 'Capture' }).click();

  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByText('Write a local release note')).toBeVisible();
  await expect(page.getByText(/Stored only in this browser/)).toBeVisible();

  await page.getByLabel('Search durable workspace').fill('release evidence');
  await page.getByRole('button', { name: 'Search' }).click();

  const results = page.getByRole('list', { name: 'Workspace search results' });
  await expect(results.getByText('Release confidence')).toBeVisible();
  await expect(results.getByText('Release evidence project')).toBeVisible();
  await expect(results.getByText('Review release evidence')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    '3 durable workspace results found.',
  );
  await expect(results).not.toContainText('Write a local release note');
});

test('announces validation, empty, unauthenticated, and unavailable states', async ({
  page,
}) => {
  let responseStatus = 200;
  let responseBody: unknown = [];
  await page.route(SEARCH_PATH, async (route) => {
    await route.fulfill({
      status: responseStatus,
      contentType:
        responseStatus === 200
          ? 'application/json'
          : 'application/problem+json',
      body: JSON.stringify(responseBody),
    });
  });

  const searchInput = page.getByLabel('Search durable workspace');
  await searchInput.fill('x');
  await searchInput.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Enter at least two characters',
  );

  await searchInput.fill('nothing here');
  await searchInput.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'No durable workspace records matched.',
  );

  responseStatus = 401;
  responseBody = {
    type: 'about:blank',
    title: 'Authentication is required',
    status: 401,
    code: 'authentication_required',
  };
  await searchInput.fill('private work');
  await searchInput.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Sign in to search durable workspace records.',
  );

  responseStatus = 503;
  responseBody = {
    type: 'about:blank',
    title: 'Planning search is unavailable',
    status: 503,
    code: 'planning_search_unavailable',
  };
  await searchInput.fill('retry later');
  await searchInput.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Workspace search is temporarily unavailable.',
  );
});

test('keeps capture and search keyboard-operable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(SEARCH_PATH, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  const captureInput = page.getByLabel('Capture locally for Today');
  await captureInput.fill('Mobile capture');
  await captureInput.press('Enter');
  await expect(page.getByRole('region', { name: 'Backlog' })).toContainText(
    'Mobile capture',
  );

  const searchInput = page.getByLabel('Search durable workspace');
  await searchInput.fill('Mobile search');
  await searchInput.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'No durable workspace records matched.',
  );
});
