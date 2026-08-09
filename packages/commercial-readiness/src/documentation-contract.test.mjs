import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CANONICAL = Object.freeze([
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
const STATUSES = Object.freeze(new Set([
  'Implemented on protected main',
  'Implemented on active PR',
  'Partial',
  'Accepted architecture',
  'Planned',
  'Research only',
  'Superseded',
  'Out of scope',
]));

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function localMarkdownLinks(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1].split('#', 1)[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/iu.test(target));
}

function assertLocalLinksResolve(relativePath) {
  const baseDir = dirname(relativePath);
  for (const target of localMarkdownLinks(read(relativePath))) {
    const resolved = normalize(join(baseDir, target));
    assert.equal(
      existsSync(join(ROOT, resolved)),
      true,
      `${relativePath} has a broken local link: ${target}`,
    );
  }
}

function assertBalancedFences(relativePath) {
  const count = read(relativePath)
    .split('\n')
    .filter((line) => line.trimStart().startsWith('```')).length;
  assert.equal(count % 2, 0, `${relativePath} has unbalanced fenced blocks`);
}

function assertBoldStatuses(relativePath) {
  for (const match of read(relativePath).matchAll(/^\*\*Status:\*\*\s*([^\r\n]+)$/gmu)) {
    assert.ok(STATUSES.has(match[1].trim()), `${relativePath} has invalid status: ${match[1]}`);
  }
}

function assertStatusTable(relativePath) {
  const lines = read(relativePath).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\|.*\bStatus\b.*\|$/u.test(lines[index])) continue;
    const headers = lines[index].split('|').slice(1, -1).map((value) => value.trim());
    const statusIndex = headers.indexOf('Status');
    if (statusIndex < 0 || index + 1 >= lines.length) continue;
    let row = index + 2;
    while (row < lines.length && lines[row].startsWith('|')) {
      const cells = lines[row].split('|').slice(1, -1).map((value) => value.trim());
      if (cells.length === headers.length) {
        assert.ok(
          STATUSES.has(cells[statusIndex]),
          `${relativePath} has invalid table status: ${cells[statusIndex]}`,
        );
      }
      row += 1;
    }
  }
}

test('canonical documentation is present and discoverable from README', () => {
  const readme = read('README.md');
  for (const relativePath of CANONICAL) {
    assert.equal(existsSync(join(ROOT, relativePath)), true, `missing canonical document: ${relativePath}`);
    assert.ok(readme.includes(`](${relativePath})`), `README does not link ${relativePath}`);
  }
  assertLocalLinksResolve('README.md');
});

test('canonical Markdown keeps balanced fences and exact status vocabulary', () => {
  for (const relativePath of CANONICAL.filter((path) => extname(path) === '.md')) {
    assertBalancedFences(relativePath);
    assertBoldStatuses(relativePath);
    assertStatusTable(relativePath);
  }
});

test('ADR index points to every exact ADR and every ADR has the quality sections', () => {
  const adrDir = join(ROOT, 'docs/adr');
  const index = read('docs/adr/README.md');
  const files = readdirSync(adrDir).filter((name) => /^\d{4}-.+\.md$/u.test(name)).sort();
  assert.deepEqual(files.map((name) => name.slice(0, 4)), ['0001','0002','0003','0004','0005','0006','0007','0008','0009']);
  for (const fileName of files) {
    const number = fileName.slice(0, 4);
    assert.ok(index.includes(`[${number}](${fileName})`), `${fileName} has no exact ADR index target`);
    const body = read(`docs/adr/${fileName}`);
    assertBoldStatuses(`docs/adr/${fileName}`);
    for (const section of [
      '## Context',
      '## Decision drivers',
      '## Considered alternatives',
      '## Decision',
      '## Consequences',
      '## Failure and recovery',
      '## Security and privacy impact',
      '## Acceptance evidence',
      '## Migration and rollback',
      '## Supersession',
    ]) {
      assert.ok(body.includes(section), `${fileName} is missing ${section}`);
    }
  }
  assertLocalLinksResolve('docs/adr/README.md');
});

test('canonical architecture claims have source and migration evidence', () => {
  const architecture = read('ARCHITECTURE.md');
  assert.match(architecture, /opaque UUIDv4/u);
  assert.match(architecture, /never read another service's database tables directly/u);
  assert.match(architecture, /AI output is an inert proposal/u);
  assert.match(read('apps/identity-service/migrations/0006_data_rights_request_ledger.sql'), /identity\.data_rights_requests/u);
  assert.match(read('apps/planning-service/migrations/0001_initial_planning.sql'), /planning\.(goals|projects|tasks)/u);
  assert.equal(existsSync(join(ROOT, 'apps/ai-service/src/proposal-service.ts')), true);
  assert.equal(existsSync(join(ROOT, 'apps/privacy-service/migrations/0001_purpose_bound_privacy_access.sql')), true);
});

test('canonical buyer-gap traceability matches repository-owned registry', () => {
  const registry = JSON.parse(read('product/buyer-gaps.json'));
  const traceability = read('docs/TRACEABILITY.md');
  const prd = read('docs/PRD.md');
  for (const gap of registry.gaps) {
    assert.match(traceability, new RegExp(gap.gap_id.replaceAll('.', '\\.'), 'u'));
    assert.ok(traceability.includes(`#${gap.issue_number}`), `traceability misses issue #${gap.issue_number}`);
    assert.ok(prd.includes(`#${gap.issue_number}`), `PRD misses canonical gap issue #${gap.issue_number}`);
  }
});

test('historical architecture alternatives are explicitly superseded', () => {
  const prd = read('docs/PRD.md');
  const assessment = read('docs/DOCUMENTATION_ASSESSMENT.md');
  for (const historical of ['local-first', 'single', 'UUIDv7']) {
    assert.match(`${prd}\n${assessment}`, new RegExp(historical, 'iu'));
  }
  assert.match(prd, /Superseded/u);
  assert.match(assessment, /Superseded/u);
});