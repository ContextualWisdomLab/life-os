import { expect, test, type Page } from '@playwright/test';

const goal = Object.freeze({
  id: 'a1111111-a111-4111-8111-a11111111111',
  title: 'Launch LifeOS',
  createdAt: '2026-09-20T08:00:00.000Z',
});
const project = Object.freeze({
  id: 'b2222222-b222-4222-8222-b22222222222',
  goalId: goal.id,
  title: 'Ship canonical Project evidence',
  createdAt: '2026-09-20T08:01:00.000Z',
});

const unavailableMessage = 'The Projects workspace is temporarily unavailable.';

async function routeCanonicalGoals(page: Page): Promise<void> {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([goal]),
    });
  });
}

test('rejects non-canonical durable UUID evidence from the Goal boundary', async ({
  page,
}) => {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...goal, id: goal.id.toUpperCase() }]),
    });
  });

  await page.goto('/projects');
  await expect(page.getByText(unavailableMessage)).toBeVisible();
  await expect(page.getByRole('button', { name: goal.title })).toHaveCount(0);
});

test('rejects non-canonical durable UUID evidence from the Project boundary', async ({
  page,
}) => {
  await routeCanonicalGoals(page);
  await page.route(`**/api/planning/goals/${goal.id}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...project,
          id: project.id.toUpperCase(),
          goalId: goal.id.toUpperCase(),
        },
      ]),
    });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: goal.title }).click();
  await expect(page.getByText(unavailableMessage)).toBeVisible();
  await expect(page.getByText(project.title)).toHaveCount(0);
});
