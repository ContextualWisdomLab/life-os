import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { evaluateCapabilities } from './audit.mjs';
import { validateCapabilityManifest } from './schema.mjs';

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), 'life-os-readiness-'));
  return {
    root,
    async write(path, content = '') {
      const fullPath = join(root, path);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    }
  };
}

function manifest(capabilities) {
  return validateCapabilityManifest({
    schema: 'life-os.capability-manifest.v1',
    capabilities
  });
}

function capability(overrides = {}) {
  return {
    id: 'planning.durable-data',
    outcome: 'Goals, projects, and tasks survive process restarts.',
    target_maturity: 'production',
    customer_impact: 5,
    risk: 4,
    acquisition_impact: 5,
    effort: 3,
    dependencies: [],
    tracking_issue: 21,
    evidence: [
      { maturity: 'prototype', kind: 'implementation', mode: 'exists', path: 'apps/planning-service/src/planning-domain.ts' },
      { maturity: 'usable', kind: 'implementation', mode: 'exists', path: 'apps/planning-service/src/postgres-planning-repository.ts' },
      { maturity: 'usable', kind: 'implementation', mode: 'not_contains', path: 'apps/planning-service/src/main.ts', value: 'InMemoryPlanningRepository' },
      { maturity: 'production', kind: 'test', mode: 'exists', path: 'apps/planning-service/src/postgres-planning-repository.integration.test.ts' }
    ],
    ...overrides
  };
}

describe('evaluateCapabilities', () => {
  it('computes observed maturity from repository evidence and removes completed gaps', async () => {
    const repository = await temporaryRepository();
    await repository.write('apps/planning-service/src/planning-domain.ts', 'export class PlanningService {}');
    await repository.write('apps/planning-service/src/postgres-planning-repository.ts', 'export class PostgresPlanningRepository {}');
    await repository.write('apps/planning-service/src/main.ts', 'new PostgresPlanningRepository()');
    await repository.write('apps/planning-service/src/postgres-planning-repository.integration.test.ts', 'test("persists", () => {})');

    const result = await evaluateCapabilities(manifest([capability()]), {
      rootDir: repository.root,
      generatedAt: '2026-08-03T06:00:00.000Z',
      commitSha: 'a'.repeat(40)
    });

    assert.equal(result.capabilities[0].observed_maturity, 'production');
    assert.equal(result.gaps.length, 0);
  });

  it('does not treat documentation-only evidence as working software', async () => {
    const repository = await temporaryRepository();
    await repository.write('docs/planning.md', 'PostgreSQL production implementation');
    const result = await evaluateCapabilities(
      manifest([
        capability({
          evidence: [
            { maturity: 'prototype', kind: 'documentation', mode: 'exists', path: 'docs/planning.md' },
            { maturity: 'usable', kind: 'implementation', mode: 'exists', path: 'apps/planning-service/src/postgres-planning-repository.ts' }
          ]
        })
      ]),
      {
        rootDir: repository.root,
        generatedAt: '2026-08-03T06:00:00.000Z',
        commitSha: 'b'.repeat(40)
      }
    );
    assert.equal(result.capabilities[0].observed_maturity, 'prototype');
    assert.equal(result.gaps.length, 1);
    assert.deepEqual(result.gaps[0].missing_evidence, [
      'apps/planning-service/src/postgres-planning-repository.ts'
    ]);
  });

  it('prioritizes buyer impact, risk, dependency blocking, and maturity distance deterministically', async () => {
    const repository = await temporaryRepository();
    const capabilities = [
      capability({ id: 'platform.foundation', customer_impact: 2, risk: 2, acquisition_impact: 2, effort: 2, tracking_issue: null }),
      capability({ id: 'identity.oauth', outcome: 'Users can sign in.', customer_impact: 5, risk: 5, acquisition_impact: 5, effort: 3, tracking_issue: 18 }),
      capability({ id: 'today.workflow', outcome: 'Users can plan and complete today.', customer_impact: 5, risk: 3, acquisition_impact: 5, effort: 4, dependencies: ['identity.oauth'], tracking_issue: null })
    ];

    const first = await evaluateCapabilities(manifest(capabilities), {
      rootDir: repository.root,
      generatedAt: '2026-08-03T06:00:00.000Z',
      commitSha: 'c'.repeat(40)
    });
    const second = await evaluateCapabilities(manifest(capabilities), {
      rootDir: repository.root,
      generatedAt: '2026-08-03T06:00:00.000Z',
      commitSha: 'c'.repeat(40)
    });

    assert.deepEqual(second, first);
    assert.equal(first.gaps[0].capability_id, 'identity.oauth');
    assert.ok(first.gaps[0].priority_score > first.gaps[1].priority_score);
  });

  it('never reports readiness above 100 percent when evidence exceeds the target', async () => {
    const repository = await temporaryRepository();
    await repository.write('apps/differentiated.ts', 'export const differentiated = true;');
    const result = await evaluateCapabilities(
      manifest([
        capability({
          target_maturity: 'prototype',
          evidence: [
            {
              maturity: 'differentiated',
              kind: 'implementation',
              mode: 'exists',
              path: 'apps/differentiated.ts'
            }
          ]
        })
      ]),
      {
        rootDir: repository.root,
        generatedAt: '2026-08-03T06:00:00.000Z',
        commitSha: 'd'.repeat(40)
      }
    );
    assert.equal(result.capabilities[0].observed_maturity, 'differentiated');
    assert.equal(result.summary.weighted_maturity_percent, 100);
  });

  it('fails closed on oversized repository evidence', async () => {
    const repository = await temporaryRepository();
    await repository.write('apps/large.ts', 'x'.repeat(1024));
    const result = await evaluateCapabilities(
      manifest([
        capability({
          evidence: [
            { maturity: 'prototype', kind: 'implementation', mode: 'contains', path: 'apps/large.ts', value: 'x', max_bytes: 64 }
          ]
        })
      ]),
      {
        rootDir: repository.root,
        generatedAt: '2026-08-03T06:00:00.000Z',
        commitSha: 'e'.repeat(40)
      }
    );
    assert.equal(result.capabilities[0].observed_maturity, 'missing');
    assert.equal(result.capabilities[0].evidence[0].status, 'unreadable');
  });

  it('fails closed when an intermediate symlink escapes the repository root', async () => {
    const repository = await temporaryRepository();
    const outside = await mkdtemp(join(tmpdir(), 'life-os-readiness-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'outside evidence', 'utf8');
    await mkdir(join(repository.root, 'apps'), { recursive: true });
    await symlink(outside, join(repository.root, 'apps', 'escape'), 'dir');

    const result = await evaluateCapabilities(
      manifest([
        capability({
          evidence: [
            {
              maturity: 'prototype',
              kind: 'implementation',
              mode: 'contains',
              path: 'apps/escape/secret.txt',
              value: 'outside evidence'
            }
          ]
        })
      ]),
      {
        rootDir: repository.root,
        generatedAt: '2026-08-03T06:00:00.000Z',
        commitSha: 'f'.repeat(40)
      }
    );

    assert.equal(result.capabilities[0].observed_maturity, 'missing');
    assert.equal(result.capabilities[0].evidence[0].status, 'unreadable');
  });
});
