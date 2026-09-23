import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const settingsPagePath = fileURLToPath(
  new URL('./settings/page.tsx', import.meta.url),
);

test('authenticated product shell has a first-party Settings route', () => {
  assert.equal(
    existsSync(settingsPagePath),
    true,
    'apps/web/app/settings/page.tsx must exist before Settings can be claimed as a buyer-visible product surface',
  );
});
