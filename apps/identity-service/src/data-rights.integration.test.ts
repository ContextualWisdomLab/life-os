import { describe, expect, it } from 'vitest';
import {
  DataRightsApplication,
  DataRightsValidationError,
  ErasureBlockedError,
  ErasureExecutionError,
  ErasureVerificationError,
  type DataExportSection,
  type DataRightsContributor,
  type DataRightsWorkspaceContext,
  type ErasureContributorReceipt,
  type ErasurePreflight,
  type JsonValue,
} from './data-rights';

const WORKSPACE_ALPHA = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_BETA = '22222222-2222-4222-8222-222222222222';
const USER_ALPHA = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const FIXED_TIME = new Date('2026-08-04T00:00:00.000Z');

class RecordingContributor implements DataRightsContributor {
  readonly exportCalls: DataRightsWorkspaceContext[] = [];
  readonly preflightCalls: DataRightsWorkspaceContext[] = [];
  readonly eraseCalls: (DataRightsWorkspaceContext & {
    readonly idempotencyKey: string;
  })[] = [];
  readonly verifyCalls: DataRightsWorkspaceContext[] = [];
  readonly erasedWorkspaces = new Set<string>();
  blocker: string | undefined;
  failErase = false;
  forceVerificationFailure = false;

  constructor(
    readonly name: string,
    private readonly dataByWorkspace: Readonly<Record<string, JsonValue>>,
    private readonly executionOrder: string[] = [],
  ) {}

  async exportWorkspace(
    context: DataRightsWorkspaceContext,
  ): Promise<DataExportSection> {
    this.exportCalls.push({ ...context });
    return {
      schemaVersion: `${this.name}.v1`,
      data: this.dataByWorkspace[context.workspaceId] ?? { records: [] },
    };
  }

  async preflightErase(
    context: DataRightsWorkspaceContext,
  ): Promise<ErasurePreflight> {
    this.preflightCalls.push({ ...context });
    return this.blocker
      ? { ready: false, blockers: [this.blocker] }
      : { ready: true, blockers: [] };
  }

  async eraseWorkspace(
    context: DataRightsWorkspaceContext & { readonly idempotencyKey: string },
  ): Promise<ErasureContributorReceipt> {
    this.eraseCalls.push({ ...context });
    this.executionOrder.push(this.name);
    if (this.failErase) {
      throw new Error('simulated dependency failure');
    }
    this.erasedWorkspaces.add(context.workspaceId);
    return { erasedRecords: 1 };
  }

  async verifyWorkspaceErased(
    context: DataRightsWorkspaceContext,
  ): Promise<boolean> {
    this.verifyCalls.push({ ...context });
    return (
      !this.forceVerificationFailure &&
      this.erasedWorkspaces.has(context.workspaceId)
    );
  }
}

function application(
  contributors: readonly DataRightsContributor[],
): DataRightsApplication {
  return new DataRightsApplication(contributors, () => FIXED_TIME);
}

describe('DataRightsApplication integration boundary', () => {
  it('builds a deterministic, tenant-scoped export without invoking mutation', async () => {
    const planning = new RecordingContributor('planning.authored-data', {
      [WORKSPACE_ALPHA]: {
        projects: [{ id: 'project-alpha', title: 'Ship LifeOS' }],
      },
      [WORKSPACE_BETA]: {
        projects: [{ id: 'project-beta', title: 'Private beta project' }],
      },
    });
    const habits = new RecordingContributor('habit.completion-history', {
      [WORKSPACE_ALPHA]: {
        completions: [{ habitId: 'habit-alpha', completedAt: '2026-08-03' }],
      },
      [WORKSPACE_BETA]: {
        completions: [{ habitId: 'habit-beta', completedAt: '2026-08-02' }],
      },
    });
    const service = application([planning, habits]);

    const first = await service.exportWorkspace({
      workspaceId: WORKSPACE_ALPHA,
      actorUserId: USER_ALPHA,
    });
    const replay = await service.exportWorkspace({
      workspaceId: WORKSPACE_ALPHA,
      actorUserId: USER_ALPHA,
    });

    expect(first).toEqual(replay);
    expect(first.sections.map((section) => section.contributor)).toEqual([
      'habit.completion-history',
      'planning.authored-data',
    ]);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.generatedAt).toBe('2026-08-04T00:00:00.000Z');
    expect(JSON.stringify(first)).not.toContain('project-beta');
    expect(planning.eraseCalls).toHaveLength(0);
    expect(habits.eraseCalls).toHaveLength(0);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections)).toBe(true);
  });

  it('passes only trusted workspace and actor ownership to every contributor', async () => {
    const identity = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { displayName: 'Alpha owner' },
    });
    const service = application([identity]);

    await service.exportWorkspace({
      workspaceId: WORKSPACE_ALPHA.toUpperCase(),
      actorUserId: USER_ALPHA.toUpperCase(),
    });

    expect(identity.exportCalls).toEqual([
      {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
    ]);
  });

  it('rejects duplicate contributors and secret-shaped export fields', async () => {
    const first = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { displayName: 'Alpha owner' },
    });
    const duplicate = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { displayName: 'Another owner' },
    });

    expect(() => application([first, duplicate])).toThrow(
      new DataRightsValidationError('Contributor names must be unique'),
    );

    const forbiddenFieldName = ['access', 'Token'].join('');
    const unsafe = new RecordingContributor('identity.unsafe-data', {
      [WORKSPACE_ALPHA]: { [forbiddenFieldName]: 'redacted-fixture-value' },
    });
    await expect(
      application([unsafe]).exportWorkspace({
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      }),
    ).rejects.toThrow('Export JSON contains a forbidden key');
  });

  it('performs every preflight before any destructive operation', async () => {
    const executionOrder: string[] = [];
    const planning = new RecordingContributor(
      'planning.authored-data',
      { [WORKSPACE_ALPHA]: { records: [] } },
      executionOrder,
    );
    const habits = new RecordingContributor(
      'habit.completion-history',
      { [WORKSPACE_ALPHA]: { records: [] } },
      executionOrder,
    );
    habits.blocker = 'A legal hold is active';
    const service = application([planning, habits]);

    const failure = await service
      .eraseWorkspace({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        idempotencyKey: IDEMPOTENCY_KEY,
        confirmation: 'erase-all-workspace-data',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ErasureBlockedError);
    expect((failure as ErasureBlockedError).blockers).toEqual({
      'habit.completion-history': ['A legal hold is active'],
    });
    expect(planning.preflightCalls).toHaveLength(1);
    expect(habits.preflightCalls).toHaveLength(1);
    expect(planning.eraseCalls).toHaveLength(0);
    expect(habits.eraseCalls).toHaveLength(0);
    expect(executionOrder).toEqual([]);
  });

  it('erases contributors in deterministic order and verifies complete absence', async () => {
    const executionOrder: string[] = [];
    const planning = new RecordingContributor(
      'planning.authored-data',
      { [WORKSPACE_ALPHA]: { records: [] } },
      executionOrder,
    );
    const identity = new RecordingContributor(
      'identity.account-data',
      { [WORKSPACE_ALPHA]: { records: [] } },
      executionOrder,
    );
    const service = application([planning, identity]);

    const receipt = await service.eraseWorkspace({
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      idempotencyKey: IDEMPOTENCY_KEY,
      confirmation: 'erase-all-workspace-data',
    });

    expect(executionOrder).toEqual([
      'identity.account-data',
      'planning.authored-data',
    ]);
    expect(receipt.contributors).toEqual([
      { contributor: 'identity.account-data', erasedRecords: 1 },
      { contributor: 'planning.authored-data', erasedRecords: 1 },
    ]);
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.verifyCalls).toEqual([
      { workspaceId: WORKSPACE_ALPHA, actorUserId: USER_ALPHA },
    ]);
    expect(planning.verifyCalls).toEqual([
      { workspaceId: WORKSPACE_ALPHA, actorUserId: USER_ALPHA },
    ]);
  });

  it('returns bounded recovery evidence when execution fails after preflight', async () => {
    const identity = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { records: [] },
    });
    const planning = new RecordingContributor('planning.authored-data', {
      [WORKSPACE_ALPHA]: { records: [] },
    });
    planning.failErase = true;
    const service = application([planning, identity]);

    const failure = await service
      .eraseWorkspace({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        idempotencyKey: IDEMPOTENCY_KEY,
        confirmation: 'erase-all-workspace-data',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ErasureExecutionError);
    expect((failure as ErasureExecutionError).completedContributors).toEqual([
      'identity.account-data',
    ]);
    expect(failure).not.toHaveProperty('cause');
  });

  it('fails closed when a contributor cannot verify tenant absence', async () => {
    const identity = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { records: [] },
    });
    identity.forceVerificationFailure = true;
    const service = application([identity]);

    const failure = await service
      .eraseWorkspace({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        idempotencyKey: IDEMPOTENCY_KEY,
        confirmation: 'erase-all-workspace-data',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ErasureVerificationError);
    expect((failure as ErasureVerificationError).contributors).toEqual([
      'identity.account-data',
    ]);
  });

  it('rejects malformed ownership, idempotency, and confirmation inputs', async () => {
    const identity = new RecordingContributor('identity.account-data', {
      [WORKSPACE_ALPHA]: { records: [] },
    });
    const service = application([identity]);

    await expect(
      service.exportWorkspace({
        workspaceId: 'not-a-workspace',
        actorUserId: USER_ALPHA,
      }),
    ).rejects.toThrow('workspaceId must be a UUIDv4');

    await expect(
      service.eraseWorkspace({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        idempotencyKey: 'not-an-idempotency-key',
        confirmation: 'erase-all-workspace-data',
      }),
    ).rejects.toThrow('idempotencyKey must be a UUIDv4');

    await expect(
      service.eraseWorkspace({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        idempotencyKey: IDEMPOTENCY_KEY,
        confirmation: 'yes',
      }),
    ).rejects.toThrow('Explicit erasure confirmation is required');
    expect(identity.eraseCalls).toHaveLength(0);
  });
});
