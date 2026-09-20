import { expect, test, type Page } from '@playwright/test';

const goal = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Launch LifeOS',
  createdAt: '2026-09-02T01:00:00.000Z',
});
const firstProject = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: goal.id,
  title: 'Ship authenticated planning workspace',
  createdAt: '2026-09-02T02:00:00.000Z',
});
const secondProject = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  goalId: goal.id,
  title: 'Close release evidence gaps',
  createdAt: '2026-09-02T03:00:00.000Z',
});
const firstTask = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  projectId: firstProject.id,
  title: 'Verify exact-head gates',
  status: 'todo',
  createdAt: '2026-09-02T04:00:00.000Z',
});
const secondTask = Object.freeze({
  id: '55555555-5555-4555-8555-555555555555',
  projectId: secondProject.id,
  title: 'Verify release provenance',
  status: 'todo',
  createdAt: '2026-09-02T05:00:00.000Z',
});

async function routeGoalsAndProjects(page: Page): Promise<void> {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([goal]),
    });
  });
  await page.route(`**/api/planning/goals/${goal.id}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstProject, secondProject]),
    });
  });
}

test('loads Tasks only after explicit Goal and Project selection', async ({ page }) => {
  let taskRequests = 0;
  await routeGoalsAndProjects(page);
  await page.route(`**/api/planning/projects/${firstProject.id}/tasks`, async (route) => {
    taskRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstTask]),
    });
  });

  await page.goto('/tasks');
  expect(taskRequests).toBe(0);
  await page.getByRole('button', { name: goal.title }).click();
  expect(taskRequests).toBe(0);
  await page.getByRole('button', { name: firstProject.title }).click();
  await expect(page.getByText(firstTask.title)).toBeVisible();
  expect(taskRequests).toBe(1);
});

test('ignores a late Task response after the user changes Project scope', async ({ page }) => {
  await routeGoalsAndProjects(page);
  let releaseFirst: (() => void) | undefined;
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(`**/api/planning/projects/${firstProject.id}/tasks`, async (route) => {
    await firstReleased;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstTask]),
    });
  });
  await page.route(`**/api/planning/projects/${secondProject.id}/tasks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([secondTask]),
    });
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: goal.title }).click();
  await page.getByRole('button', { name: firstProject.title }).click();
  await page.getByRole('button', { name: secondProject.title }).click();
  await expect(page.getByText(secondTask.title)).toBeVisible();
  releaseFirst?.();
  await expect(page.getByText(firstTask.title)).toHaveCount(0);
  await expect(page.getByText(secondTask.title)).toBeVisible();
});

test('creates a Task only after submit and renders returned durable evidence', async ({ page }) => {
  await routeGoalsAndProjects(page);
  let postCount = 0;
  await page.route(`**/api/planning/projects/${firstProject.id}/tasks`, async (route) => {
    if (route.request().method() === 'POST') {
      postCount += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(firstTask),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: goal.title }).click();
  await page.getByRole('button', { name: firstProject.title }).click();
  await page.getByLabel('Task title').fill(firstTask.title);
  expect(postCount).toBe(0);
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText(firstTask.title)).toBeVisible();
  await expect(page.getByText('To do')).toBeVisible();
  expect(postCount).toBe(1);
});

test('counts and limits Task titles by Unicode code point', async ({ page }) => {
  await routeGoalsAndProjects(page);
  await page.route(`**/api/planning/projects/${firstProject.id}/tasks`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: goal.title }).click();
  await page.getByRole('button', { name: firstProject.title }).click();
  const titleInput = page.getByLabel('Task title');
  await titleInput.fill('😀'.repeat(161));
  await expect(titleInput).toHaveValue('😀'.repeat(160));
  await expect(page.getByText('160/160')).toBeVisible();
});

test('fails closed when the authenticated Goal boundary rejects the session', async ({ page }) => {
  await page.route('**/api/planning/goals', async (route) => {
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

  await page.goto('/tasks');
  await expect(
    page.getByText('Sign in before changing the durable Tasks workspace.'),
  ).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveCount(0);
});

test('keeps the Tasks workspace usable without horizontal overflow on phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeGoalsAndProjects(page);
  await page.route(`**/api/planning/projects/${firstProject.id}/tasks`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/tasks');
  const goalButton = page.getByRole('button', { name: goal.title });
  await expect(goalButton).toBeVisible();
  expect(await goalButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
