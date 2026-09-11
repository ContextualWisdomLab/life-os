import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const POSTGRES_CI_IMAGE =
  'postgres:16.15-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825';
const POSTGRES_INITDB_ARGS =
  '--auth-local=scram-sha-256 --auth-host=scram-sha-256';

const workflowPaths = [
  '../../../.github/workflows/ci.yml',
  '../../../.github/workflows/ai-proposal-live-conformance.yml',
  '../../../.github/workflows/opencode-commercial-development.yml',
].map((path) => resolve(import.meta.dirname, path));

/** Return every YAML `postgres` service block without including the following peer key. */
function postgresServiceBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s+)postgres:\s*$/u.exec(lines[index] ?? '');
    if (!match) continue;
    const indent = match[1].length;
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (line.trim()) {
        const lineIndent = /^\s*/u.exec(line)?.[0].length ?? 0;
        if (lineIndent <= indent) break;
      }
      block.push(line);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

describe('PostgreSQL CI service contract', () => {
  it('uses a locale-capable immutable image and explicit SCRAM init authentication', () => {
    const blocks = workflowPaths.flatMap((path) =>
      postgresServiceBlocks(readFileSync(path, 'utf8')),
    );

    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      expect(block).toContain(`image: ${POSTGRES_CI_IMAGE}`);
      expect(block).toContain('POSTGRES_HOST_AUTH_METHOD: scram-sha-256');
      expect(block).toContain(`POSTGRES_INITDB_ARGS: ${POSTGRES_INITDB_ARGS}`);
      expect(block).not.toMatch(/image:\s+postgres:[^\n]*-alpine@/u);
    }
  });
});
