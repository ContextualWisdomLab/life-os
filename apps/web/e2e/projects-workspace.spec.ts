import { expect, test, type Page } from '@playwright/test';

const firstGoal = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Launch LifeOS',
  createdAt: '2026-09-02T01:00:00.000Z',
});
const secondGoal = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Harden the operating loop',
  createdAt: '2026-09-02T02:00:00.000Z',
});
const firstProject = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: firstGoal.id,
  title: 'Ship authenticated planning workspace',
  createdAt: '2026-09-02T03:00:00.000Z',
});
const secondProject = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  goalId: secondGoal.id,
  title: 'Close release evidence gaps',
  createdAt: '2026-09-02T04:00:00.000Z',
});

async function routeGoals(page: Page): Promise<void> {
  await page.route('**/api/planning/goals', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstGoal, secondGoal]),
    });
  });
}

test('loads Projects only after selecting durable Goal evidence', async ({ page }) => {
  await routeGoals(page);
  await page.route(`**/api/planning/goals/${firstGoal.id}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstProject]),
    });
  });

  await page.goto('/projects');
  await expect(page.getByText('Select a goal to inspect its projects.')).toBeVisible();
  await page.getByRole('button', { name: firstGoal.title }).click();
  await expect(page.getByText(firstProject.title)).toBeVisible();
});

test('ignores a late Project response after the user changes Goal scope', async ({ page }) => {
  await routeGoals(page);
  let releaseFirst: (() => void) | undefined;
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(`**/api/planning/goals/${firstGoal.id}/projects`, async (route) => {
    await firstReleased;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([firstProject]),
    });
  });
  await page.route(`**/api/planning/goals/${secondGoal.id}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([secondProject]),
    });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: firstGoal.title }).click();
  await page.getByRole('button', { name: secondGoal.title }).click();
  await expect(page.getByText(secondProject.title)).toBeVisible();

  releaseFirst?.();
  await expect(page.getByText(secondProject.title)).toBeVisible();
  await expect(page.getByText(firstProject.title)).toHaveCount(0);
});

test('creates a Project only after explicit submit and displays returned evidence', async ({ page }) => {
  await routeGoals(page);
  let postCount = 0;
  await page.route(`**/api/planning/goals/${firstGoal.id}/projects`, async (route) => {
    if (route.request().method() === 'POST') {
      postCount += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(firstProject),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: firstGoal.title }).click();
  await page.getByLabel('Project title').fill(firstProject.title);
  expect(postCount).toBe(0);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText(firstProject.title)).toBeVisible();
  expect(postCount).toBe(1);
});

test('counts and limits Project titles by Unicode code point', async ({ page }) => {
  await routeGoals(page);
  await page.route(`**/api/planning/goals/${firstGoal.id}/projects`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: firstGoal.title }).click();
  const titleInput = page.getByLabel('Project title');
  await titleInput.fill('😀'.repeat(161));
  await expect(titleInput).toHaveValue('😀'.repeat(160));
  await expect(page.getByText('160/160')).toBeVisible();
});
