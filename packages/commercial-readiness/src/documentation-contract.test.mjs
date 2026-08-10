import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REQUIRED = Object.freeze([
  'docs/PRD.md',
  'docs/TRD.md',
  'ARCHITECTURE.md',
  'docs/adr/README.md',
  'docs/DATA_MODEL.md',
  'docs/UML.md',
  'docs/API_CONTRACTS.md',
  'SECURITY.md',
  'docs/THREAT_MODEL.md',
  'docs/PRIVACY_DATA_LIFECYCLE.md',
  'docs/TEST_STRATEGY.md',
  'docs/OPERABILITY.md',
  'docs/RELEASE_AND_MIGRATION.md',
  'docs/STANDARDS_TRACEABILITY.md',
  'docs/TRACEABILITY.md',
  'docs/DOCUMENTATION_ASSESSMENT.md',
]);
const STATUSES = Object.freeze([
  'Implemented on protected main',
  'Implemented on active PR',
  'Partial',
  'Accepted architecture',
  'Planned',
  'Research only',
  'Superseded',
  'Out of scope',
]);

/** Reads a repository UTF-8 file. */
function text(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Returns local Markdown link targets from one Markdown document. */
function localLinks(relativePath) {
  const body = text(relativePath);
  return [...body.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1].split('#', 1)[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/iu.test(target));
}

/** Resolves a local Markdown target from its containing document. */
function resolveLocal(relativePath, target) {
  return join(ROOT, dirname(relativePath), target);
}

/** Extracts exact **Status:** metadata values. */
function metadataStatuses(body) {
  return [...body.matchAll(/^\*\*Status:\*\* ([^\r\n]+)$/gmu)].map((match) =>
    match[1].trim(),
  );
}

/** Splits a Markdown table row into normalized cells. */
function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((value) => value.trim());
}

/** Returns whether cells form a Markdown table separator row. */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

/** Extracts values only from table columns whose exact header is Status. */
function tableStatuses(body) {
  const lines = body.split('\n');
  const statuses = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trimStart().startsWith('|')) continue;
    const headers = tableCells(lines[index]);
    const statusIndex = headers.indexOf('Status');
    if (statusIndex < 0) continue;
    const separators = tableCells(lines[index + 1]);
    if (separators.length !== headers.length || !isSeparatorRow(separators)) continue;

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].trimStart().startsWith('|')) break;
      const cells = tableCells(lines[rowIndex]);
      if (cells.length !== headers.length || isSeparatorRow(cells)) continue;
      statuses.push(cells[statusIndex]);
    }
  }
  return statuses;
}

test('canonical documentation files exist and are linked from README', () => {
  const readme = text('README.md');
  for (const path of REQUIRED) {
    assert.equal(existsSync(join(ROOT, path)), true, `missing ${path}`);
    assert.ok(readme.includes(`](${path})`), `README missing link to ${path}`);
  }
});

test('local README and canonical-document links resolve to repository files', () => {
  for (const path of ['README.md', ...REQUIRED.filter((item) => item.endsWith('.md'))]) {
    for (const target of localLinks(path)) {
      assert.equal(
        existsSync(resolveLocal(path, target)),
        true,
        `${path} has broken local link ${target}`,
      );
    }
  }
});

test('canonical status metadata and requirement tables use the exact vocabulary', () => {
  for (const path of REQUIRED.filter((item) => item.endsWith('.md'))) {
    const body = text(path);
    for (const status of [...metadataStatuses(body), ...tableStatuses(body)]) {
      assert.ok(STATUSES.includes(status), `${path} has invalid status: ${status}`);
    }
  }
});

test('ADR index targets every material ADR and ADRs satisfy the quality contract', () => {
  const index = text('docs/adr/README.md');
  const files = readdirSync(join(ROOT, 'docs/adr'))
    .filter((name) => /^\d{4}-.+\.md$/u.test(name))
    .sort();
  const requiredNumbers = new Set(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009']);

  for (const number of requiredNumbers) {
    assert.ok(files.some((name) => name.startsWith(`${number}-`)), `missing ADR ${number}`);
  }

  for (const file of files) {
    const number = file.slice(0, 4);
    assert.ok(index.includes(`[${number}](${file})`), `${file} missing exact index target`);
    const body = text(`docs/adr/${file}`);
    const status = metadataStatuses(body)[0];
    assert.ok(status !== undefined && STATUSES.includes(status), `${file} has invalid status`);
    for (const heading of [
      '## Context',
      '## Decision',
      '## Consequences',
      '## Failure and recovery',
      '## Security and privacy impact',
      '## Acceptance evidence',
      '## Migration and rollback',
      '## Supersession',
    ]) {
      assert.ok(body.includes(heading), `${file} missing ${heading}`);
    }
  }
});

test('canonical Markdown keeps balanced fenced code blocks', () => {
  for (const path of REQUIRED.filter((item) => item.endsWith('.md'))) {
    const count = text(path)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('```')).length;
    assert.equal(count % 2, 0, `${path} has an unbalanced code fence`);
  }
});

test('documentation claims are anchored to current source authority', () => {
  const agents = text('AGENTS.md');
  const architecture = text('ARCHITECTURE.md');
  const dataRights = text('apps/identity-service/src/data-rights.ts');
  const proposals = text('apps/ai-service/src/proposal-service.ts');
  const dataModel = text('docs/DATA_MODEL.md');
  const threatModel = text('docs/THREAT_MODEL.md');

  assert.match(agents, /Internal identifiers are opaque UUIDv4 strings/u);
  assert.match(dataRights, /UUID_V4_PATTERN/u);
  assert.match(dataRights, /-4\[0-9a-f\]\{3\}/u);
  assert.match(architecture, /never read another service's database tables directly/u);
  assert.match(dataModel, /does not authorize cross-service SQL joins/iu);
  assert.match(proposals, /requiresConfirmation: true/u);
  assert.match(proposals, /cannot execute its own operations/u);
  assert.match(threatModel, /AI prompt injection \/ silent mutation/u);
});

test('canonical lifecycle reflects protected-main integrations and remaining gaps', () => {
  const prd = text('docs/PRD.md');
  const traceability = text('docs/TRACEABILITY.md');
  const assessment = text('docs/DOCUMENTATION_ASSESSMENT.md');

  assert.match(prd, /PR #127 merged as protected main/u);
  assert.match(prd, /PR #139 merged/u);
  assert.match(prd, /PRs #134, #136, #137, #138 and #144 integrated on main/u);
  assert.match(traceability, /#55 data portability completion/u);
  assert.match(traceability, /#129 per-user calendar credentials/u);
  assert.match(traceability, /#130 plugin runtime delivery/u);
  assert.match(assessment, /old documentation PR #126 became materially diverged/u);
});
