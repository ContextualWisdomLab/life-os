import { describe, expect, it } from 'vitest';
import {
  DataRightsDependencyError,
  DataRightsValidationError,
  type WorkspaceDataRightsSource,
  WorkspaceDataRightsCoordinator,
  verifyWorkspaceDataExport,
} from './data-rights';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const GENERATED_AT = '2026-08-04T00:00:00.000Z';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

class StaticSource implements WorkspaceDataRightsSource {
  readonly calls: string[] = [];

  constructor(
    readonly sourceId: string,
    private readonly snapshot: unknown,
  ) {}

  async inspectWorkspace(workspaceId: string): Promise<unknown> {
    this.calls.push(workspaceId);
    return this.snapshot;
  }
}

function planningSnapshot(recordOrder: 'forward' | 'reverse' = 'forward') {
  const records = [
    {
      id: TASK_ID,
      kind: 'task',
      data: {
        title: 'Verify portable export',
        completed: false,
      },
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'goal',
      data: {
        title: 'Own my data',
        metadata: { priority: 1, labels: ['privacy', 'trust'] },
      },
    },
  ];
  return {
    sourceId: 'planning',
    workspaceId: WORKSPACE_ID,
    schemaVersion: 'planning.v1',
    records: recordOrder === 'forward' ? records : [...records].reverse(),
    erasure: { mode: 'erase' },
  };
}

function identitySnapshot() {
  return {
    sourceId: 'identity',
    workspaceId: WORKSPACE_ID,
    schemaVersion: 'identity.v1',
    records: [
      {
        id: USER_ID,
        kind: 'user',
        data: {
          displayName: 'Export Owner',
          providers: ['github'],
        },
      },
    ],
    erasure: {
      mode: 'retain',
      reason: 'Security event evidence remains under the published policy.',
      until: '2026-09-03T00:00:00.000Z',
    },
  };
}

describe('WorkspaceDataRightsCoordinator integration contract', () => {
  it('creates a deterministic versioned export across explicitly registered sources', async () => {
    const identity = new StaticSource('identity', identitySnapshot());
    const planning = new StaticSource('planning', planningSnapshot('reverse'));
    const coordinator = new WorkspaceDataRightsCoordinator([
      planning,
      identity,
    ]);

    const exported = await coordinator.createExport(WORKSPACE_ID, GENERATED_AT);
    const equivalent = await new WorkspaceDataRightsCoordinator([
      new StaticSource('identity', identitySnapshot()),
      new StaticSource('planning', planningSnapshot('forward')),
    ]).createExport(WORKSPACE_ID, GENERATED_AT);

    expect(exported.schemaVersion).toBe('life-os.workspace-export.v1');
    expect(exported.workspaceId).toBe(WORKSPACE_ID);
    expect(exported.sources.map((source) => source.sourceId)).toEqual([
      'identity',
      'planning',
    ]);
    expect(exported.sources[1]?.records.map((record) => record.kind)).toEqual([
      'goal',
      'task',
    ]);
    expect(exported.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(exported.digest).toBe(equivalent.digest);
    expect(identity.calls).toEqual([WORKSPACE_ID]);
    expect(planning.calls).toEqual([WORKSPACE_ID]);
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported.sources)).toBe(true);
  });

  it('verifies intact bundles and rejects tampered portable evidence', async () => {
    const exported = await new WorkspaceDataRightsCoordinator([
      new StaticSource('identity', identitySnapshot()),
      new StaticSource('planning', planningSnapshot()),
    ]).createExport(WORKSPACE_ID, GENERATED_AT);

    expect(verifyWorkspaceDataExport(exported)).toEqual(exported);

    const tampered = structuredClone(exported);
    const task = tampered.sources[1]?.records.find(
      (record) => record.id === TASK_ID,
    );
    if (!task) {
      throw new Error('Test fixture task is missing');
    }
    (task.data as { title: string }).title = 'Silently changed';

    expect(() => verifyWorkspaceDataExport(tampered)).toThrow(
      DataRightsValidationError,
    );
  });

  it('fails closed on cross-tenant output, duplicate sources, and unbounded records', async () => {
    expect(
      () =>
        new WorkspaceDataRightsCoordinator([
          new StaticSource('identity', identitySnapshot()),
          new StaticSource('identity', identitySnapshot()),
        ]),
    ).toThrow(DataRightsValidationError);

    const crossTenant = new WorkspaceDataRightsCoordinator([
      new StaticSource('identity', {
        ...identitySnapshot(),
        workspaceId: OTHER_WORKSPACE_ID,
      }),
    ]);
    await expect(
      crossTenant.createExport(WORKSPACE_ID, GENERATED_AT),
    ).rejects.toBeInstanceOf(DataRightsValidationError);

    const unbounded = new WorkspaceDataRightsCoordinator([
      new StaticSource('identity', {
        ...identitySnapshot(),
        records: [
          {
            id: USER_ID,
            kind: 'user',
            data: { value: 'x'.repeat(70 * 1_024) },
          },
        ],
      }),
    ]);
    await expect(
      unbounded.createExport(WORKSPACE_ID, GENERATED_AT),
    ).rejects.toBeInstanceOf(DataRightsValidationError);
  });

  it('produces fail-closed erasure readiness without granting deletion capability', async () => {
    const identity = new StaticSource('identity', identitySnapshot());
    const planning = new StaticSource('planning', planningSnapshot());
    const readiness = await new WorkspaceDataRightsCoordinator([
      planning,
      identity,
    ]).evaluateErasureReadiness(WORKSPACE_ID, GENERATED_AT);

    expect(readiness).toEqual({
      workspaceId: WORKSPACE_ID,
      evaluatedAt: GENERATED_AT,
      ready: false,
      sourceIds: ['identity', 'planning'],
      blockers: [
        {
          sourceId: 'identity',
          reason: 'Security event evidence remains under the published policy.',
          until: '2026-09-03T00:00:00.000Z',
        },
      ],
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect('eraseWorkspace' in identity).toBe(false);
    expect('eraseWorkspace' in planning).toBe(false);
  });

  it('maps source failures to a bounded credential-free dependency error', async () => {
    const failing: WorkspaceDataRightsSource = {
      sourceId: 'identity',
      async inspectWorkspace() {
        throw new Error('postgresql://admin:secret@database.internal/private');
      },
    };
    const coordinator = new WorkspaceDataRightsCoordinator([failing]);

    await expect(
      coordinator.createExport(WORKSPACE_ID, GENERATED_AT),
    ).rejects.toEqual(new DataRightsDependencyError());
  });
});
