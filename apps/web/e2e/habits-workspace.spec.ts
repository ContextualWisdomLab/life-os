import { expect, test, type Page } from '@playwright/test';

const dailyHabit = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Review the day',
  timezone: 'Asia/Seoul',
  startsOn: '2026-09-02',
  recurrence: Object.freeze({ kind: 'daily', interval: 1 }),
  createdAt: '2026-09-02T11:30:00.000Z',
});

const weeklyHabit = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Plan the week',
  timezone: 'Asia/Seoul',
  startsOn: '2026-09-07',
  recurrence: Object.freeze({ kind: 'weekly', interval: 1, weekdays: [1, 5] }),
  createdAt: '2026-09-02T11:31:00.000Z',
});

async function routeHabitList(page: Page, habits: readonly unknown[] = []): Promise<void> {
  await page.route('**/api/habits', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(habits),
    });
  });
}

async function fillDailyHabit(page: Page, title = dailyHabit.title): Promise<void> {
  await page.getByLabel('Habit title').fill(title);
  await page.getByLabel('Timezone').fill(dailyHabit.timezone);
  await page.getByLabel('Start date').fill(dailyHabit.startsOn);
  await page.getByLabel('Daily').check();
  await page.getByLabel('Repeat every day(s)').fill('1');
}

test('renders only validated durable Habit evidence returned by the BFF', async ({ page }) => {
  await routeHabitList(page, [dailyHabit]);

  await page.goto('/habits');

  await expect(page.getByText(dailyHabit.title)).toBeVisible();
  await expect(page.getByText('Every day')).toBeVisible();
  await expect(page.getByText(`Starts ${dailyHabit.startsOn} · ${dailyHabit.timezone}`)).toBeVisible();
});

test('creates a Habit only after explicit submit and displays returned durable evidence', async ({ page }) => {
  let postCount = 0;
  let postedBody: unknown;
  await page.route('**/api/habits', async (route) => {
    if (route.request().method() === 'POST') {
      postCount += 1;
      postedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(dailyHabit),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/habits');
  await fillDailyHabit(page);
  expect(postCount).toBe(0);

  await page.getByRole('button', { name: 'Create habit' }).click();

  await expect(page.getByText(dailyHabit.title)).toBeVisible();
  expect(postCount).toBe(1);
  expect(postedBody).toEqual({
    title: dailyHabit.title,
    timezone: dailyHabit.timezone,
    startsOn: dailyHabit.startsOn,
    recurrence: { kind: 'daily', interval: 1 },
  });
});

test('synchronous repeated submit cannot dispatch two Habit mutations', async ({ page }) => {
  let postCount = 0;
  let releasePost: (() => void) | undefined;
  const postReleased = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route('**/api/habits', async (route) => {
    if (route.request().method() === 'POST') {
      postCount += 1;
      await postReleased;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(dailyHabit),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/habits');
  await fillDailyHabit(page);
  const form = page.locator('form');
  await form.evaluate((element) => {
    const habitForm = element as HTMLFormElement;
    habitForm.requestSubmit();
    habitForm.requestSubmit();
  });
  await expect.poll(() => postCount).toBe(1);
  releasePost?.();
  await expect(page.getByText(dailyHabit.title)).toBeVisible();
  expect(postCount).toBe(1);
});

test('weekly recurrence preserves explicit sorted weekday evidence', async ({ page }) => {
  let postedBody: unknown;
  await page.route('**/api/habits', async (route) => {
    if (route.request().method() === 'POST') {
      postedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(weeklyHabit),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/habits');
  await page.getByLabel('Habit title').fill(weeklyHabit.title);
  await page.getByLabel('Timezone').fill(weeklyHabit.timezone);
  await page.getByLabel('Start date').fill(weeklyHabit.startsOn);
  await page.getByLabel('Weekly').check();
  await page.getByLabel('Repeat every week(s)').fill('1');
  await page.getByLabel('Fri').check();
  await page.getByRole('button', { name: 'Create habit' }).click();

  await expect(page.getByText(weeklyHabit.title)).toBeVisible();
  await expect(page.getByText('Every week · Monday, Friday')).toBeVisible();
  expect(postedBody).toEqual({
    title: weeklyHabit.title,
    timezone: weeklyHabit.timezone,
    startsOn: weeklyHabit.startsOn,
    recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
  });
});

test('counts and limits Habit titles by Unicode code point', async ({ page }) => {
  await routeHabitList(page);

  await page.goto('/habits');
  const titleInput = page.getByLabel('Habit title');
  await titleInput.fill('😀'.repeat(161));

  await expect(titleInput).toHaveValue('😀'.repeat(160));
  await expect(page.getByText('160/160')).toBeVisible();
});

test('fails closed when authenticated Habit authority is unavailable', async ({ page }) => {
  await page.route('**/api/habits', async (route) => {
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

  await page.goto('/habits');

  await expect(page.getByText('Sign in before changing the durable Habits workspace.')).toBeVisible();
  await expect(page.getByLabel('Habit title')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create habit' })).toBeDisabled();
});

test('keeps the Habits workspace usable without horizontal overflow on phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeHabitList(page);

  await page.goto('/habits');

  const brand = page.getByRole('link', { name: 'LifeOS Today' });
  await expect(brand).toBeVisible();
  expect(await brand.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
