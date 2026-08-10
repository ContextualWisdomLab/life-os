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
  return [...text(relativePath).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
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

/** Returns whether every cell is a Markdown table separator. */
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
      if (cells.length !== headers.length && !isSeparatorRow(cells)) continue;
      if (cells.length === headers.length && !isSeparatorRow(cells)) {
        statuses.push(cells[statusIndex]);
      }
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
  const requiredNumbers = new Set([
    '0001', '0002', '0003', '0004', '0005', '0006',
    '0007', '0008', '0009', '0010', '0011', '0012',
  ]);

  for (const number of requiredNumbers) {
    assert.ok(files.some((name) => name.startsWith(`${number}-`)), `missing ADR ${number}`);
  }

  for (const file of files) {
    const number = file.slice(0, 4);
    assert.ok(index.includes(`[${number}](${file})`), `${file} missing exact index target`);
    const body = text(`docs/adr/${file}`);
    assert.ok(STATUSES.includes(metadataStatuses(body)[0]), `${file} has invalid status`);
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

test('root architecture remains semantically anchored to protected-main authority', () => {
  const architecture = text('ARCHITECTURE.md');
  const agents = text('AGENTS.md');
  const dataRights = text('apps/identity-service/src/data-rights.ts');
  const proposals = text('apps/ai-service/src/proposal-service.ts');

  assert.match(agents, /Internal identifiers are opaque UUIDv4 strings/u);
  assert.match(dataRights, /UUID_V4_PATTERN/u);
  assert.match(architecture, /never read or mutate another service's tables directly/u);
  assert.match(architecture, /Authentication-ceremony time is distinct/u);
  assert.match(architecture, /Durable Today synchronization is protected-main behavior/u);
  assert.match(architecture, /PR #150 added/u);
  assert.match(architecture, /PR #153 added atomic/u);
  assert.match(architecture, /PR #151/u);
  assert.match(architecture, /Privacy owns purpose-bound sensitive-access decisions/u);
  assert.match(architecture, /Notification owns reminder occurrences/u);
  assert.match(architecture, /docs\/PRD\.md/u);
  assert.match(proposals, /requiresConfirmation: true/u);
  assert.match(proposals, /cannot execute its own operations/u);
});

test('protected lifecycle and remaining parent gaps are represented truthfully', () => {
  const prd = text('docs/PRD.md');
  const traceability = text('docs/TRACEABILITY.md');
  const contracts = text('docs/API_CONTRACTS.md');
  const privacy = text('docs/PRIVACY_DATA_LIFECYCLE.md');
  const dataModel = text('docs/DATA_MODEL.md');

  for (const protectedPr of [
    '#127', '#139', '#146', '#149', '#150', '#151', '#153', '#154', '#155',
  ]) {
    assert.match(prd, new RegExp(`PR ${protectedPr}`, 'u'));
  }
  assert.match(traceability, /PRD-CAL-004.*Implemented on protected main/u);
  assert.match(traceability, /PRD-CAL-005.*Implemented on protected main/u);
  assert.match(traceability, /PRD-INT-003.*Implemented on protected main/u);
  assert.match(traceability, /PRD-PRIV-004.*Implemented on protected main/u);
  assert.match(traceability, /PRD-PRIV-005.*Implemented on protected main/u);
  assert.match(contracts, /Atomic calendar connection revocation.*Implemented on protected main/u);
  assert.match(contracts, /Explicit plugin installation grants.*Implemented on protected main/u);
  assert.match(privacy, /atomic local connection revocation \(#153\)/u);
  assert.match(dataModel, /PR #153 added atomic tenant\+user-scoped revocation/u);
  assert.match(traceability, /#55 data portability completion/u);
  assert.match(traceability, /#129 hosted per-user calendar credentials/u);
  assert.match(traceability, /#130 plugin runtime delivery/u);
});

test('current successor maturity follows protected main and active work', () => {
  const prd = text('docs/PRD.md');
  const traceability = text('docs/TRACEABILITY.md');
  const contracts = text('docs/API_CONTRACTS.md');
  const uml = text('docs/UML.md');
  const architecture = text('ARCHITECTURE.md');
  const assessment = text('docs/DOCUMENTATION_ASSESSMENT.md');
  const dataModel = text('docs/DATA_MODEL.md');
  const integrationAuthority = text(
    'docs/adr/0011-external-integration-authority-and-secret-references.md',
  );

  for (const protectedPr of ['#154', '#155']) {
    assert.match(prd, new RegExp(`PR ${protectedPr}`, 'u'));
    assert.match(traceability, new RegExp(`PR ${protectedPr}`, 'u'));
    assert.match(assessment, new RegExp(`PR ${protectedPr}`, 'u'));
  }
  assert.match(prd, /PR #156/u);
  assert.match(traceability, /PR #156/u);
  assert.match(assessment, /PR #156/u);
  assert.match(dataModel, /PR #156/u);
  assert.match(architecture, /PR #155.*Implemented on protected main/su);
  assert.match(architecture, /PR #154.*Implemented on protected main/su);
  assert.match(architecture, /Old PR #147 is \*\*Superseded\*\*/u);
  assert.match(uml, /PR #154.*protected main/su);
  assert.match(uml, /life-os\.calendar-user\.v1/u);
  assert.match(assessment, /protected-main documentation insufficient/iu);
  assert.match(integrationAuthority, /opaque secret handle/iu);
  assert.match(integrationAuthority, /manifest expresses requested intent/iu);
  assert.match(contracts, /PR #156/u);
});

test('model-assisted compute authority and counterevidence remain canonical', () => {
  const architecture = text('ARCHITECTURE.md');
  const standards = text('docs/STANDARDS_TRACEABILITY.md');
  const uml = text('docs/UML.md');
  const traceability = text('docs/TRACEABILITY.md');
  const agents = text('AGENTS.md');
  const adr = text('docs/adr/0012-test-time-compute-and-model-development-authority.md');

  assert.match(adr, /strong single-model route/iu);
  assert.match(adr, /workflow stages/iu);
  assert.match(adr, /decomposition/iu);
  assert.match(adr, /recursion depth/iu);
  assert.match(adr, /role-specific reasoning effort/iu);
  assert.match(adr, /access (?:list|topology)/iu);
  assert.match(adr, /NVIDIA_NIM_API_KEY/u);
  assert.match(adr, /COPILOT_GITHUB_TOKEN/u);
  assert.match(adr, /deterministic/iu);

  for (const evidenceName of ['Fugu', 'Conductor', 'TRINITY']) {
    assert.match(standards, new RegExp(evidenceName, 'u'));
  }
  assert.match(standards, /Rethinking the value of multi-agent workflow/iu);
  assert.match(standards, /preprint/iu);
  assert.match(standards, /ICLR 2026/iu);
  assert.match(standards, /NVIDIA NIM/iu);
  assert.match(standards, /repository-specific/iu);

  assert.match(uml, /NVIDIA_NIM_API_KEY/u);
  assert.match(uml, /contextual-orchestrator/iu);
  assert.match(uml, /single-route/iu);
  assert.match(uml, /conduct/iu);
  assert.match(uml, /deterministic LifeOS proposal evaluator/iu);
  assert.match(uml, /review.*merge.*release/isu);

  assert.match(traceability, /ADR 0012/u);
  assert.match(traceability, /Fugu/iu);
  assert.match(architecture, /A strong single-model route is measured before deeper orchestration/u);
  assert.match(agents, /NVIDIA_NIM_API_KEY/u);
  assert.doesNotMatch(agents, /use\s+COPILOT_GITHUB_TOKEN/iu);
});

test('canonical authority does not regress to superseded product identity', () => {
  const canonical = REQUIRED
    .filter((path) => path.endsWith('.md'))
    .map((path) => text(path))
    .join('\n');

  assert.doesNotMatch(canonical, /UUIDv7 is the (?:current|primary|required) LifeOS identifier/iu);
  assert.doesNotMatch(canonical, /login-free local-first is the (?:current|primary|required) architecture/iu);
  assert.doesNotMatch(canonical, /single[- ]application is the (?:current|primary|required) durable architecture/iu);
});
