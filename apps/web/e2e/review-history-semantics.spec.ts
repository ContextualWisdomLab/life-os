import { expect, test } from '@playwright/test';

const dailyPlanning = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  ritualKind: 'daily-planning',
  periodStartDate: '2026-09-02',
  completedStepCount: 3,
  totalStepCount: 3,
  plannedItemCount: 4,
  completedItemCount: 0,
  habitCompletionCount: 0,
  completedAt: '2026-09-02T00:15:00.000Z',
  recordedAt: '2026-09-02T00:15:01.000Z',
});

test('daily Review evidence is labelled as a date rather than a weekly period', async ({ page }) => {
  await page.route('**/api/reviews/completions?limit=50', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([dailyPlanning]),
    });
  });

  await page.goto('/review');

  await expect(page.getByRole('heading', { name: '2026-09-02' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Week of 2026-09-02' })).toHaveCount(0);
});
