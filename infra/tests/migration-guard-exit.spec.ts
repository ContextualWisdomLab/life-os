import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');

/** Reads the production migration runner exactly as shipped by the repository. */
function migrationRunner(): string {
  return readFileSync(
    resolve(repositoryRoot, 'infra/kubernetes/run-migrations.sh'),
    'utf8',
  );
}

describe('migration guard failure contract', () => {
  it('propagates every migration-ledger guard failure through ON_ERROR_STOP', () => {
    const runner = migrationRunner();

    expect(runner).not.toContain('\\quit 1');
    expect(
      runner.match(/RAISE EXCEPTION 'LifeOS migration guard failed'/gu),
    ).toHaveLength(3);
  });
});
