import { expect, test } from '@playwright/test';

const TODAY_DRAFT_KEY = 'life-os.today-draft.v1';
const ONBOARDING_COMPLETION_KEY = 'life-os.onboarding-completion.v1';
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
  await page.waitForLoadState('networkidle');
  expect(goalWrites).toEqual([]);

  const stored = await page.evaluate(
    ({ todayDraftKey, onboardingCompletionKey, attachmentDraftKey }) => ({
      todayDraft: window.localStorage.getItem(todayDraftKey),
      onboardingCompletion: window.localStorage.getItem(
        onboardingCompletionKey,
      ),
      attachmentDraft: window.localStorage.getItem(attachmentDraftKey),
    }),
    {
      todayDraftKey: TODAY_DRAFT_KEY,
      onboardingCompletionKey: ONBOARDING_COMPLETION_KEY,
      attachmentDraftKey: ATTACHMENT_DRAFT_KEY,
    },
  );

  expect(stored.todayDraft).not.toBeNull();
  expect(JSON.parse(stored.todayDraft ?? '{}')).toMatchObject({
    version: TODAY_DRAFT_KEY,
    actions: [
      expect.objectContaining({
        title: 'Review the release evidence',
      }),
    ],
  });

  expect(stored.onboardingCompletion).not.toBeNull();
  expect(JSON.parse(stored.onboardingCompletion ?? '{}')).toMatchObject({
    version: ONBOARDING_COMPLETION_KEY,
  });

  expect(stored.attachmentDraft).not.toBeNull();
  expect(JSON.parse(stored.attachmentDraft ?? '{}')).toMatchObject({
    version: ATTACHMENT_DRAFT_KEY,
    direction: 'Prepare a calm product launch',
    nextAction: 'Review the release evidence',
    attachmentDecision: 'pending',
  });
});
