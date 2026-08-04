import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('switches the complete core workflow to Korean and persists the choice', async ({
  page,
}) => {
  await page.getByLabel('Language').selectOption('ko');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(
    page.getByRole('heading', { name: '실행 가능한 하루를 만드세요.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '주요 탐색' }),
  ).toBeVisible();

  await page
    .getByLabel('오늘 할 일을 로컬에 기록')
    .fill('한국어 접근성 점검');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByText('한국어 접근성 점검')).toBeVisible();

  await page.getByLabel('워크스페이스 영구 기록 검색').fill('한');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    '워크스페이스를 검색하려면 두 글자 이상 입력하세요.',
  );

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByLabel('언어')).toHaveValue('ko');
  await expect(page.getByText('한국어 접근성 점검')).toBeVisible();
});

test('exposes semantic landmarks, visible keyboard focus, and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();

  await expect(page.getByRole('main')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'LifeOS' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'LifeOS' })).toHaveCSS(
    'outline-style',
    'solid',
  );
});
