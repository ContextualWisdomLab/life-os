import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE_SOURCE = readFileSync(
  resolve(__dirname, 'data-rights-request-ledger.integration.test.ts'),
  'utf8',
);

describe('data-rights request ledger integration fixture', () => {
  it('serializes database ownership without force-terminating active clients', () => {
    expect(FIXTURE_SOURCE).not.toContain('WITH (FORCE)');
    expect(FIXTURE_SOURCE).toContain('pg_advisory_lock');
    expect(FIXTURE_SOURCE).toContain('pg_advisory_unlock');
  });
});
