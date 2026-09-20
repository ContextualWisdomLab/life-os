import { expect, test, type Page } from '@playwright/test';

const goal = Object.freeze({
  id: 'a1111111-a111-4111-8111-a11111111111',
  title: 'Launch LifeOS',
  createdAt: '2026-09-20T06:00:00.000Z',
});
const project = Object.freeze({
  id: 'b2222222-b222-4222-8222-b22222222222',
  goalId: goal.id,
  title: 'Ship canonical evidence handling',
  createdAt: '2026-09-20T06:01:00.000Z',
});
const task = Object.freeze({
  id: 'c3333333-c333-4333-8333-c33333333333',
  projectId: project.id,
  title: 'Reject recanonicalized durable identity',
  status: 'todo',
  createdAt: '2026-09-20T06:02:00.000Z',
});

const unavailableMessage =
  'Tasks are temporarily unavailable. Existing evidence is unchanged.';

async function routeCanonicalGoals(page: Page): Promise<void> {
  await page.route('**/api/planning/goals', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([goal]),
    });
  });
}

async function routeCanonicalProjects(page: Page): Promise<void> {
  await page.route(`**/api/planning/goals/${goal.id}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([project]),
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

  await page.goto('/tasks');
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

  await page.goto('/tasks');
  await page.getByRole('button', { name: goal.title }).click();
  await expect(page.getByText(unavailableMessage)).toBeVisible();
  await expect(page.getByRole('button', { name: project.title })).toHaveCount(0);
});

test('rejects non-canonical durable UUID evidence from the Task boundary', async ({
  page,
}) => {
  await routeCanonicalGoals(page);
  await routeCanonicalProjects(page);
  await page.route(`**/api/planning/projects/${project.id}/tasks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...task,
          id: task.id.toUpperCase(),
          projectId: project.id.toUpperCase(),
        },
      ]),
    });
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: goal.title }).click();
  await page.getByRole('button', { name: project.title }).click();
  await expect(page.getByText(unavailableMessage)).toBeVisible();
  await expect(page.getByText(task.title)).toHaveCount(0);
});
