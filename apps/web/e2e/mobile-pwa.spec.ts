import { expect, test } from '@playwright/test';

const EXPECTED_PUBLIC_CACHE_PATHS = [
  '/icons/life-os.svg',
  '/manifest.webmanifest',
  '/offline',
];

test('exposes a standards-based install manifest', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain(
    'application/manifest+json',
  );

  const manifest = (await response.json()) as {
    readonly id?: string;
    readonly name?: string;
    readonly short_name?: string;
    readonly start_url?: string;
    readonly scope?: string;
    readonly display?: string;
    readonly icons?: readonly {
      readonly src?: string;
      readonly type?: string;
      readonly purpose?: string;
    }[];
  };
  expect(manifest).toMatchObject({
    id: '/',
    name: 'LifeOS',
    short_name: 'LifeOS',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: '/icons/life-os.svg',
        type: 'image/svg+xml',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/life-os.svg',
        type: 'image/svg+xml',
        purpose: 'maskable',
      }),
    ]),
  );
});

test('registers one bounded shell cache without storing Today HTML', async ({
  page,
}) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.serviceWorker ?? null,
      ),
    )
    .toBe('registered');

  async function readCachedPaths(): Promise<string[]> {
    return page.evaluate(async () => {
      const cacheNames = (await caches.keys()).filter((name) =>
        name.startsWith('life-os-shell-'),
      );
      const requests = (
        await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            return cache.keys();
          }),
        )
      ).flat();
      return requests.map((request) => new URL(request.url).pathname).sort();
    });
  }

  await expect.poll(readCachedPaths).toEqual(EXPECTED_PUBLIC_CACHE_PATHS);
  const cachedPaths = await readCachedPaths();
  expect(cachedPaths).not.toContain('/');
  expect(cachedPaths).not.toContain('/onboarding');
});

test('serves the credential-free fallback for an offline navigation', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.serviceWorker ?? null,
      ),
    )
    .toBe('registered');
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.goto('/offline-probe', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'LifeOS is offline.' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'this offline page does not read or cache your planning data',
      ),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
