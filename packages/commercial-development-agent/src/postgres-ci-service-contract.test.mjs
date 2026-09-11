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

/** Return one direct child mapping from a PostgreSQL service block. */
function directChildMappingBlock(block, key) {
  const lines = block.split('\n');
  const serviceMatch = /^(\s+)postgres:\s*$/u.exec(lines[0] ?? '');
  if (!serviceMatch) throw new Error('invalid PostgreSQL service block');

  const mappingIndent = serviceMatch[1].length + 2;
  const mappingIndexes = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = /^(\s+)([\w-]+):\s*$/u.exec(line);
    if (match && match[1].length === mappingIndent && match[2] === key) {
      mappingIndexes.push(index);
    }
  }
  expect(mappingIndexes).toHaveLength(1);

  const start = mappingIndexes[0];
  const mapping = [lines[start]];
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? '';
    if (line.trim()) {
      const lineIndent = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (lineIndent <= mappingIndent) break;
    }
    mapping.push(line);
  }
  return mapping.join('\n');
}

/** Assert an exact scalar is a direct entry of an extracted YAML mapping. */
function expectDirectMappingEntry(mappingBlock, key, value) {
  const lines = mappingBlock.split('\n');
  const mappingMatch = /^(\s+)[\w-]+:\s*$/u.exec(lines[0] ?? '');
  if (!mappingMatch) throw new Error('invalid YAML mapping block');
  const entryIndent = ' '.repeat(mappingMatch[1].length + 2);
  expect(lines).toContain(`${entryIndent}${key}: ${value}`);
}

/** Assert the current PostgreSQL service policy against one extracted service block. */
function expectSecurePostgresServiceBlock(block) {
  expect(block).toContain(`image: ${POSTGRES_CI_IMAGE}`);
  const envBlock = directChildMappingBlock(block, 'env');
  expectDirectMappingEntry(
    envBlock,
    'POSTGRES_HOST_AUTH_METHOD',
    'scram-sha-256',
  );
  expectDirectMappingEntry(envBlock, 'POSTGRES_INITDB_ARGS', POSTGRES_INITDB_ARGS);
  expect(block).not.toMatch(/image:\s+postgres:[^\n]*-alpine@/u);
}

describe('PostgreSQL CI service contract', () => {
  it('uses a locale-capable immutable image and explicit SCRAM init authentication', () => {
    const blocks = workflowPaths.flatMap((path) =>
      postgresServiceBlocks(readFileSync(path, 'utf8')),
    );

    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      expectSecurePostgresServiceBlock(block);
    }
  });

  it('rejects authentication settings placed outside the service env mapping', () => {
    const malformedBlock = [
      '      postgres:',
      `        image: ${POSTGRES_CI_IMAGE}`,
      '        env:',
      '          POSTGRES_DB: life_os_test',
      '        labels:',
      '          POSTGRES_HOST_AUTH_METHOD: scram-sha-256',
      `          POSTGRES_INITDB_ARGS: ${POSTGRES_INITDB_ARGS}`,
    ].join('\n');

    expect(() => expectSecurePostgresServiceBlock(malformedBlock)).toThrow();
  });

  it('rejects a floating image even when the reviewed digest appears elsewhere', () => {
    const malformedBlock = [
      '      postgres:',
      '        image: postgres:16.15-bookworm',
      '        env:',
      '          POSTGRES_HOST_AUTH_METHOD: scram-sha-256',
      `          POSTGRES_INITDB_ARGS: ${POSTGRES_INITDB_ARGS}`,
      '        labels:',
      `          reviewed-image: ${POSTGRES_CI_IMAGE}`,
    ].join('\n');

    expect(() => expectSecurePostgresServiceBlock(malformedBlock)).toThrow();
  });
});
