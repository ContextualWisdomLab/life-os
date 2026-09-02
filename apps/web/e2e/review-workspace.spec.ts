import { expect, test, type Page } from '@playwright/test';

const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_START = '2026-08-31';

const durableReview = Object.freeze({
  id: REVIEW_ID,
  ritualKind: 'weekly-review',
  periodStartDate: PERIOD_START,
  completedStepCount: 5,
  totalStepCount: 5,
  plannedItemCount: 8,
  completedItemCount: 6,
  habitCompletionCount: 9,
  reflection: 'Keep next week smaller.',
  completedAt: '2026-09-02T12:00:00.000Z',
  recordedAt: '2026-09-02T12:00:01.000Z',
});

async function routeReviewHistory(
  page: Page,
  history: readonly unknown[] = [],
): Promise<void> {
  await page.route('**/api/reviews/completions?limit=50', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(history),
    });
  });
}

async function completeReviewForm(page: Page): Promise<void> {
  await page.getByLabel('Week starting Monday').fill(PERIOD_START);
  for (const step of [
    'Check what you committed to last week',
    'Name projects that moved or stalled',
    'Clear overdue or obsolete tasks',
    'Check habit evidence without judging missed days',
    'Choose a smaller set of commitments for next week',
  ]) {
    await page.getByLabel(step).check();
  }
  await page.getByLabel('Planned items').fill('8');
  await page.getByLabel('Completed items').fill('6');
  await page.getByLabel('Habit completions').fill('9');
  await page.getByLabel(/Reflection/).fill(durableReview.reflection);
}

test('renders only validated immutable Review history returned by the BFF', async ({ page }) => {
  await routeReviewHistory(page, [durableReview]);

  await page.goto('/review');

  await expect(page.getByRole('heading', { name: `Week of ${PERIOD_START}` })).toBeVisible();
  await expect(page.getByText('6 / 8')).toBeVisible();
  await expect(page.getByText(durableReview.reflection)).toBeVisible();
});

test('records Weekly Review only after explicit completion and accepts returned durable evidence', async ({ page }) => {
  let postCount = 0;
  let postedBody: Record<string, unknown> | undefined;
  await routeReviewHistory(page);
  await page.route('**/api/reviews/weekly-review/completions', async (route) => {
    postCount += 1;
    postedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ...durableReview,
        completedAt: postedBody.completedAt,
      }),
    });
  });

  await page.goto('/review');
  await completeReviewForm(page);
  expect(postCount).toBe(0);

  await page.getByRole('button', { name: 'Record Weekly Review' }).click();

  await expect(page.getByRole('heading', { name: `Week of ${PERIOD_START}` })).toBeVisible();
  expect(postCount).toBe(1);
  expect(postedBody?.periodStartDate).toBe(PERIOD_START);
  expect(postedBody?.completedStepCount).toBe(5);
  expect(postedBody?.totalStepCount).toBe(5);
  expect(postedBody?.plannedItemCount).toBe(8);
  expect(postedBody?.completedItemCount).toBe(6);
  expect(postedBody?.habitCompletionCount).toBe(9);
  expect(postedBody?.reflection).toBe(durableReview.reflection);
  expect(postedBody).not.toHaveProperty('workspaceId');
  expect(postedBody?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  expect(postedBody?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
});

test('synchronous repeated submit cannot dispatch two Review mutations', async ({ page }) => {
  let postCount = 0;
  let releasePost: (() => void) | undefined;
  const postReleased = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await routeReviewHistory(page);
  await page.route('**/api/reviews/weekly-review/completions', async (route) => {
    postCount += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await postReleased;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...durableReview, completedAt: body.completedAt }),
    });
  });

  await page.goto('/review');
  await completeReviewForm(page);
  await page.locator('form').evaluate((element) => {
    const reviewForm = element as HTMLFormElement;
    reviewForm.requestSubmit();
    reviewForm.requestSubmit();
  });

  await expect.poll(() => postCount).toBe(1);
  releasePost?.();
  await expect(page.getByRole('heading', { name: `Week of ${PERIOD_START}` })).toBeVisible();
  expect(postCount).toBe(1);
});

test('409 conflict preserves prior durable history and exposes recovery', async ({ page }) => {
  await routeReviewHistory(page, [durableReview]);
  await page.route('**/api/reviews/weekly-review/completions', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Weekly Review completion conflicts with existing evidence',
        status: 409,
        code: 'review_completion_conflict',
      }),
    });
  });

  await page.goto('/review');
  await completeReviewForm(page);
  await page.getByRole('button', { name: 'Record Weekly Review' }).click();

  await expect(page.getByText('This Weekly Review already has conflicting durable evidence. Reload before retrying.')).toBeVisible();
  await expect(page.getByText(durableReview.reflection)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload durable history' })).toBeVisible();
});

test('fails closed when authenticated Review authority is unavailable', async ({ page }) => {
  await page.route('**/api/reviews/completions?limit=50', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Authentication is required',
        status: 401,
        code: 'authentication_required',
      }),
    });
  });

  await page.goto('/review');

  await expect(page.getByText('Sign in to read or record durable Review history.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record Weekly Review' })).toBeDisabled();
});

test('keeps Review usable without horizontal overflow at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeReviewHistory(page);

  await page.goto('/review');

  const brand = page.getByRole('link', { name: 'LifeOS Today' });
  await expect(brand).toBeVisible();
  expect(await brand.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
