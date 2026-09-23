import { expect, test } from '@playwright/test';

const ATTACHMENT_DRAFT_KEY = 'life-os.onboarding-attachment-draft.v1';

test.beforeEach(async ({ page }) => {
  await page.goto('/onboarding');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('retains the exact local onboarding direction for later explicit durable attachment', async ({
  page,
}) => {
  const goalWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/api/planning/goals') &&
      request.method() !== 'GET'
    ) {
      goalWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page
    .getByLabel('What direction matters most right now?')
    .fill('Prepare a calm product launch');
  await page
    .getByLabel('What is the next visible action?')
    .fill('Review the release evidence');
  await page.getByRole('button', { name: 'Create my first plan' }).click();

  await expect(page).toHaveURL('/');
  expect(goalWrites).toEqual([]);

  const storedAttachmentDraft = await page.evaluate((key) => {
    return window.localStorage.getItem(key);
  }, ATTACHMENT_DRAFT_KEY);

  expect(storedAttachmentDraft).not.toBeNull();
  expect(JSON.parse(storedAttachmentDraft ?? '{}')).toMatchObject({
    version: ATTACHMENT_DRAFT_KEY,
    direction: 'Prepare a calm product launch',
    nextAction: 'Review the release evidence',
    attachmentDecision: 'pending',
  });
});
