import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REQUIRED_DOCUMENTS = Object.freeze([
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
const CANONICAL_STATUSES = Object.freeze([
  'Implemented on protected main',
  'Implemented on active PR',
  'Partial',
  'Accepted architecture',
  'Planned',
  'Research only',
  'Superseded',
  'Out of scope',
]);
const REQUIRED_ADR_FILES = Object.freeze([
  '0001-opaque-non-numeric-identifiers.md',
  '0002-oauth-transactions-and-session-tokens.md',
  '0002-internal-identifiers-uuidv4.md',
  '0003-domain-oriented-service-data-ownership.md',
  '0004-inert-auditable-ai-proposals.md',
  '0005-purpose-bound-sensitive-data-access.md',
  '0006-work-conserving-autonomous-maintenance.md',
  '0007-canonical-documentation-graph.md',
  '0008-separate-capability-maturity-from-buyer-gap-exhaustion.md',
  '0009-product-hosting-and-data-evolution.md',
]);
const REQUIRED_ADR_SECTIONS = Object.freeze([
  /^## Context$/mu,
  /^## Drivers$/mu,
  /^## Alternatives$/mu,
  /^## Decision$/mu,
  /^## Consequences$/mu,
  /^## Failure(?: and |\/)recovery$/mu,
  /^## Security(?: and |\/)privacy impact$/mu,
  /^## Acceptance evidence$/mu,
  /^## Migration(?: \/|\/)rollback$/mu,
  /^## Supersession$/mu,
]);

/** Reads one repository-owned UTF-8 file. */
function readRepositoryText(relativePath) {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');
}

/** Counts Markdown code-fence openings and closings irrespective of language tag. */
function countCodeFences(text) {
  return text.split('\n').filter((line) => line.trimStart().startsWith('```'))
    .length;
}

/** Returns local Markdown link targets from one document. */
function localMarkdownTargets(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1].trim())
    .filter(
      (target) =>
        !target.startsWith('#') &&
        !/^[a-z][a-z0-9+.-]*:/iu.test(target),
    )
    .map((target) => target.split('#', 1)[0].split('?', 1)[0])
    .filter((target) => target.length > 0);
}

/** Resolves and verifies one local documentation link without allowing repository escape. */
function assertLocalLinkExists(sourcePath, target) {
  const sourceDirectory = dirname(join(REPOSITORY_ROOT, sourcePath));
  const resolvedTarget = resolve(sourceDirectory, target);
  const relativeTarget = relative(REPOSITORY_ROOT, resolvedTarget);
  assert.ok(
    relativeTarget !== '..' && !relativeTarget.startsWith(`..${sep}`),
    `${sourcePath} link escapes repository: ${target}`,
  );
  assert.equal(
    existsSync(resolvedTarget),
    true,
    `${sourcePath} link target does not exist: ${target}`,
  );
}

/** Splits a Markdown table row into trimmed cells. */
function markdownCells(line) {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/** Asserts PRD requirement table rows use the exact canonical status vocabulary. */
function assertPrdStatuses(text, sourcePath) {
  for (const line of text.split('\n')) {
    if (!/^\| PRD-[A-Z0-9-]+ \|/u.test(line)) continue;
    const cells = markdownCells(line);
    assert.ok(
      CANONICAL_STATUSES.includes(cells[2]),
      `${sourcePath} has non-canonical status for ${cells[0]}: ${cells[2]}`,
    );
  }
}

/** Asserts traceability requirement rows use the exact canonical status vocabulary. */
function assertTraceabilityStatuses(text, sourcePath) {
  for (const line of text.split('\n')) {
    if (!/^\| PRD-[A-Z0-9-]+/u.test(line)) continue;
    const cells = markdownCells(line);
    assert.ok(
      CANONICAL_STATUSES.includes(cells[1]),
      `${sourcePath} has non-canonical status for ${cells[0]}: ${cells[1]}`,
    );
  }
}

/** Asserts the API boundary registry's Status column uses canonical values only. */
function assertApiRegistryStatuses(text, sourcePath) {
  const section = text.split('## 3. HTTP bounded-context registry')[1]?.split('## 4.')[0];
  assert.ok(section, `${sourcePath} is missing the HTTP boundary registry`);
  for (const line of section.split('\n')) {
    if (!line.startsWith('|') || /^\|\s*[-:]+/u.test(line)) continue;
    const cells = markdownCells(line);
    if (cells[0] === 'Boundary') continue;
    assert.ok(
      CANONICAL_STATUSES.includes(cells[3]),
      `${sourcePath} has non-canonical API status for ${cells[0]}: ${cells[3]}`,
    );
  }
}

/** Asserts every explicit Markdown status field uses one exact canonical value. */
function assertStatusFields(text, sourcePath) {
  for (const match of text.matchAll(/^\*\*Status:\*\* ([^\r\n]+)$/gmu)) {
    const status = match[1].trim().replace(/\s{2}$/u, '');
    assert.ok(
      CANONICAL_STATUSES.includes(status),
      `${sourcePath} has non-canonical status field: ${status}`,
    );
  }
}

test('canonical product and architecture documents remain discoverable', () => {
  for (const relativePath of REQUIRED_DOCUMENTS) {
    assert.equal(
      existsSync(join(REPOSITORY_ROOT, relativePath)),
      true,
      `missing canonical document: ${relativePath}`,
    );
  }
});

test('README canonical links resolve to real repository targets', () => {
  const readme = readRepositoryText('README.md');
  const targets = new Set(localMarkdownTargets(readme));
  for (const relativePath of REQUIRED_DOCUMENTS) {
    assert.ok(targets.has(relativePath), `README does not link ${relativePath}`);
  }
  for (const target of targets) {
    assertLocalLinkExists('README.md', target);
  }
});

test('canonical Markdown documents keep balanced fenced blocks', () => {
  for (const relativePath of REQUIRED_DOCUMENTS) {
    const fenceCount = countCodeFences(readRepositoryText(relativePath));
    assert.equal(
      fenceCount % 2,
      0,
      `${relativePath} has an unbalanced Markdown code fence`,
    );
  }
});

test('canonical requirement, API, and status fields use one exact vocabulary', () => {
  assertPrdStatuses(readRepositoryText('docs/PRD.md'), 'docs/PRD.md');
  assertTraceabilityStatuses(
    readRepositoryText('docs/TRACEABILITY.md'),
    'docs/TRACEABILITY.md',
  );
  assertApiRegistryStatuses(
    readRepositoryText('docs/API_CONTRACTS.md'),
    'docs/API_CONTRACTS.md',
  );
  for (const relativePath of [
    'docs/UML.md',
    'docs/OPERABILITY.md',
    'docs/PRIVACY_DATA_LIFECYCLE.md',
    'docs/adr/README.md',
  ]) {
    assertStatusFields(readRepositoryText(relativePath), relativePath);
  }
});

test('ADR index targets every material ADR by stable filename and every ADR uses canonical status', () => {
  const adrDirectory = join(REPOSITORY_ROOT, 'docs/adr');
  const adrIndex = readRepositoryText('docs/adr/README.md');
  const indexTargets = new Set(localMarkdownTargets(adrIndex));
  const adrFiles = readdirSync(adrDirectory)
    .filter((name) => /^\d{4}-.+\.md$/u.test(name))
    .sort();

  for (const fileName of REQUIRED_ADR_FILES) {
    assert.ok(adrFiles.includes(fileName), `missing material ADR ${fileName}`);
  }

  for (const fileName of adrFiles) {
    const adr = readRepositoryText(`docs/adr/${fileName}`);
    const status = /^\*\*Status:\*\* ([^\r\n]+)$/mu.exec(adr)?.[1]?.trim();
    assert.ok(indexTargets.has(fileName), `${fileName} missing from ADR index`);
    assertLocalLinkExists('docs/adr/README.md', fileName);
    assert.ok(
      status !== undefined && CANONICAL_STATUSES.includes(status),
      `${fileName} has unsupported or missing ADR status: ${String(status)}`,
    );
    for (const sectionPattern of REQUIRED_ADR_SECTIONS) {
      assert.match(adr, sectionPattern, `${fileName} missing required ADR section`);
    }
  }
});

test('current canonical architecture resolves historical identifier and hosting drift', () => {
  const architecture = readRepositoryText('ARCHITECTURE.md');
  const assessment = readRepositoryText('docs/DOCUMENTATION_ASSESSMENT.md');
  const prd = readRepositoryText('docs/PRD.md');

  assert.match(architecture, /opaque UUIDv4/u);
  assert.match(architecture, /multi-user, server-backed, self-hostable modular MSA/u);
  assert.match(architecture, /superseded/iu);
  assert.match(assessment, /UUIDv7 proposal → UUIDv4 protected-main invariant/u);
  assert.match(prd, /Superseded: login-free local-first product as primary architecture/u);
});

test('canonical architecture claims remain bound to real source/configuration evidence', () => {
  for (const evidencePath of [
    'apps/planning-service/src/postgres-planning-repository.ts',
    '.github/workflows/opencode-commercial-development.yml',
    'apps/privacy-service/src',
    'infra/backup',
    'infra/kubernetes',
  ]) {
    assert.equal(
      existsSync(join(REPOSITORY_ROOT, evidencePath)),
      true,
      `documented evidence path disappeared: ${evidencePath}`,
    );
  }

  const architecture = readRepositoryText('ARCHITECTURE.md');
  const dataModel = readRepositoryText('docs/DATA_MODEL.md');
  const threatModel = readRepositoryText('docs/THREAT_MODEL.md');
  const agentWorkflow = readRepositoryText(
    '.github/workflows/opencode-commercial-development.yml',
  );

  assert.match(architecture, /never read or mutate another service's database tables directly/u);
  assert.match(dataModel, /do \*\*not\*\* authorize cross-service SQL joins/u);
  assert.match(architecture, /AI output is an inert proposal/u);
  assert.match(threatModel, /AI proposals remain inert and auditable/u);
  assert.match(agentWorkflow, /NVIDIA_NIM_API_KEY/u);
  assert.doesNotMatch(agentWorkflow, /COPILOT_GITHUB_TOKEN/u);
});

test('data and UML views preserve protected-main planning and event-direction truth', () => {
  const dataModel = readRepositoryText('docs/DATA_MODEL.md');
  const uml = readRepositoryText('docs/UML.md');

  assert.match(
    dataModel,
    /Protected-main Planning migrations currently create only `planning\.goals`, `planning\.projects`, and `planning\.tasks`/u,
  );
  assert.match(dataModel, /`milestone_record` — planned\/logical/u);
  assert.match(dataModel, /`task_dependency` — planned\/logical/u);
  assert.match(uml, /Planning -\. publishes domain events \.-> NATS/u);
  assert.match(uml, /NATS -\. delivers reminder\/event inputs \.-> Notification/u);
  assert.match(uml, /planning-only DSN\/role\/schema/u);
  assert.match(uml, /privacy-only DSN\/role\/schema/u);
});

test('canonical contracts keep data lifecycle and release gaps explicit', () => {
  const apiContracts = readRepositoryText('docs/API_CONTRACTS.md');
  const privacyLifecycle = readRepositoryText('docs/PRIVACY_DATA_LIFECYCLE.md');
  const releaseContract = readRepositoryText('docs/RELEASE_AND_MIGRATION.md');
  const standards = readRepositoryText('docs/STANDARDS_TRACEABILITY.md');

  assert.match(apiContracts, /planning\.task\.completed\.v1/u);
  assert.match(apiContracts, /issue #129/u);
  assert.match(apiContracts, /Durable Today workspace synchronization/u);
  assert.match(privacyLifecycle, /\*\*Status:\*\* Partial/u);
  assert.match(privacyLifecycle, /\*\*Tracking:\*\* issue `#55`/u);
  assert.match(privacyLifecycle, /issue #129/u);
  assert.match(releaseContract, /A merged feature is not automatically a release/u);
  assert.match(releaseContract, /Application rollback/u);
  assert.match(standards, /Normative standard\/specification/u);
  assert.match(standards, /Peer-reviewed research/u);
});

test('traceability distinguishes protected main, active implementation, and buyer gaps', () => {
  const traceability = readRepositoryText('docs/TRACEABILITY.md');

  assert.match(traceability, /PRD-AI-006 autonomous OpenCode development loop \| Implemented on protected main/u);
  assert.match(traceability, /PR #122 merged as `876850018a17323900844e79845ba395b7bf6a9a`/u);
  assert.match(traceability, /PR #127/u);
  assert.match(traceability, /PR #131/u);
  assert.match(traceability, /PR #133/u);
  assert.match(traceability, /Issue #129/u);
  assert.match(traceability, /Issue #130/u);
});
