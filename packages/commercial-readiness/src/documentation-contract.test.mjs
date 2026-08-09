import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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
const ALLOWED_ADR_STATUSES = Object.freeze([
  'Accepted',
  'Proposed',
  'Superseded',
  'Deprecated',
]);

/** Reads one repository-owned UTF-8 documentation file. */
function readRepositoryText(relativePath) {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');
}

/** Counts Markdown code-fence openings/closings irrespective of language tag. */
function countCodeFences(text) {
  return text.split('\n').filter((line) => line.trimStart().startsWith('```'))
    .length;
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

test('README links every canonical document', () => {
  const readme = readRepositoryText('README.md');
  for (const relativePath of REQUIRED_DOCUMENTS) {
    assert.ok(
      readme.includes(`](${relativePath})`),
      `README does not link canonical document: ${relativePath}`,
    );
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

test('ADR index covers every material ADR with an allowed status', () => {
  const adrDirectory = join(REPOSITORY_ROOT, 'docs/adr');
  const adrIndex = readRepositoryText('docs/adr/README.md');
  const adrFiles = readdirSync(adrDirectory)
    .filter((name) => /^\d{4}-.+\.md$/u.test(name))
    .sort();

  assert.ok(adrFiles.length >= 7, 'canonical ADR set unexpectedly shrank');
  for (const fileName of adrFiles) {
    const adr = readRepositoryText(`docs/adr/${fileName}`);
    const number = fileName.slice(0, 4);
    const status = /\*\*Status:\*\* ([A-Za-z]+)/u.exec(adr)?.[1];
    assert.ok(adrIndex.includes(`[${number}](`), `${fileName} missing from ADR index`);
    assert.ok(
      status !== undefined && ALLOWED_ADR_STATUSES.includes(status),
      `${fileName} has an unsupported or missing ADR status`,
    );
    for (const section of [
      '## Context',
      '## Decision',
      '## Consequences',
      '## Supersession',
    ]) {
      assert.ok(adr.includes(section), `${fileName} missing ${section}`);
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

test('canonical architecture preserves service-owned persistence and inert AI authority', () => {
  const architecture = readRepositoryText('ARCHITECTURE.md');
  const dataModel = readRepositoryText('docs/DATA_MODEL.md');
  const threatModel = readRepositoryText('docs/THREAT_MODEL.md');

  assert.match(architecture, /never read or mutate another service's database tables directly/u);
  assert.match(dataModel, /do \*\*not\*\* authorize cross-service SQL joins/u);
  assert.match(architecture, /AI output is an inert proposal/u);
  assert.match(threatModel, /AI proposals remain inert and auditable/u);
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
  assert.match(privacyLifecycle, /Partial \/ issue #55/u);
  assert.match(privacyLifecycle, /issue #129/u);
  assert.match(releaseContract, /A merged feature is not automatically a release/u);
  assert.match(releaseContract, /Application rollback/u);
  assert.match(standards, /Normative standard\/specification/u);
  assert.match(standards, /Peer-reviewed research/u);
});

test('traceability records merged OpenCode automation and live buyer gaps accurately', () => {
  const traceability = readRepositoryText('docs/TRACEABILITY.md');

  assert.match(traceability, /PRD-AI-006 autonomous OpenCode development loop \| Implemented on protected main/u);
  assert.match(traceability, /PR #122 merged as `876850018a17323900844e79845ba395b7bf6a9a`/u);
  assert.match(traceability, /Issue #128 now tracks this audit defect/u);
  assert.match(traceability, /Issue #129/u);
  assert.match(traceability, /Issue #130/u);
});