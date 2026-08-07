import { describe, expect, it, vi } from 'vitest';
import {
  PrivacyAccessApplication,
  PrivacyAccessApplicationError,
  readOriginalPersonalData,
  type AuthorizedPersonalDataReader,
} from './privacy-access-application';
import type {
  PrivacyAccessRepository,
  PrivacyDecisionPersistenceInput,
  PrivacyGrantConsumptionInput,
  PrivacyGrantConsumptionReceipt,
} from './privacy-access-repository';
import { parsePrivacyGrantKeyRing } from './privacy-access-token';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-08-07T02:00:00.000Z');
const AUDIT_KEY = Buffer.alloc(32, 0x51).toString('base64url');
const GRANT_KEY = Buffer.alloc(32, 0x52).toString('base64url');

class RecordingRepository implements PrivacyAccessRepository {
  readonly persisted: PrivacyDecisionPersistenceInput[] = [];
  readonly consumed: PrivacyGrantConsumptionInput[] = [];
  private readonly used = new Set<string>();

  async persistDecision(input: PrivacyDecisionPersistenceInput): Promise<void> {
    this.persisted.push(input);
  }

  async consumeGrant(
    input: PrivacyGrantConsumptionInput,
  ): Promise<PrivacyGrantConsumptionReceipt> {
    if (this.used.has(input.claims.grantId)) {
      throw new Error('private replay detail');
    }
    this.used.add(input.claims.grantId);
    this.consumed.push(input);
    return Object.freeze({
      accessEventId: input.accessEventId,
      grantId: input.claims.grantId,
      decisionId: input.claims.decisionId,
      workspaceId: input.claims.workspaceId,
      actorId: input.claims.actorId,
      purpose: input.claims.purpose,
      action: input.claims.action,
      resourceCategory: input.claims.resourceCategory,
      accessMode: input.claims.accessMode,
      policyRevisionId: input.claims.policyRevisionId,
      policyDigest: input.claims.policyDigest,
      occurredAt: input.occurredAt,
    });
  }
}

/** Creates an application with deterministic identifiers and clock. */
function application(repository = new RecordingRepository()) {
  const identifiers = [DECISION_ID, GRANT_ID, EVENT_ID];
  return {
    repository,
    service: new PrivacyAccessApplication({
      repository,
      grantKeyRing: parsePrivacyGrantKeyRing({
        PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-2026-08-a',
        PRIVACY_GRANT_ACTIVE_KEY_SECRET: GRANT_KEY,
      }),
      auditDigestKey: AUDIT_KEY,
      uuidFactory: () => identifiers.shift() ?? EVENT_ID,
      clock: () => new Date(NOW.getTime()),
    }),
  };
}

describe('PrivacyAccessApplication decisions', () => {
  it('persists an allowed decision before returning one opaque grant token', async () => {
    const fixture = application();
    const result = await fixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });

    expect(result.decision).toMatchObject({
      decisionId: DECISION_ID,
      grantId: GRANT_ID,
      outcome: 'allowed',
      issuedAt: NOW.toISOString(),
      expiresAt: '2026-08-07T02:10:00.000Z',
    });
    expect(result.grantToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(fixture.repository.persisted).toHaveLength(1);
    expect(fixture.repository.persisted[0]).toMatchObject({
      decision: result.decision,
      tokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(fixture.repository.persisted)).not.toContain(
      result.grantToken,
    );
  });

  it('persists a denied decision without creating a token or grant digest', async () => {
    const fixture = application();
    const result = await fixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'export',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    expect(result).toEqual({
      decision: expect.objectContaining({
        decisionId: DECISION_ID,
        outcome: 'denied',
      }),
    });
    expect(fixture.repository.persisted[0]).toEqual({
      decision: result.decision,
    });
  });

  it('never returns a decision when persistence fails', async () => {
    const repository = new RecordingRepository();
    vi.spyOn(repository, 'persistDecision').mockRejectedValueOnce(
      new Error('database password private'),
    );
    const fixture = application(repository);
    await expect(
      fixture.service.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).rejects.toEqual(new PrivacyAccessApplicationError());
  });
});

describe('PrivacyAccessApplication consumption', () => {
  it('verifies and consumes one exact actor/workspace grant', async () => {
    const fixture = application();
    const issued = await fixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    const receipt = await fixture.service.consume({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken: issued.grantToken ?? '',
      resourceReference: '  계획 항목 Ａ-17  ',
    });

    expect(receipt).toMatchObject({
      accessEventId: EVENT_ID,
      grantId: GRANT_ID,
      decisionId: DECISION_ID,
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      resourceCategory: 'planning_content',
      occurredAt: NOW.toISOString(),
    });
    expect(fixture.repository.consumed).toHaveLength(1);
    expect(fixture.repository.consumed[0]).toMatchObject({
      tokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      resourceReferenceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    const serialized = JSON.stringify(fixture.repository.consumed[0]);
    expect(serialized).not.toContain(issued.grantToken ?? 'missing');
    expect(serialized).not.toContain('계획 항목');
  });

  it('rejects replay, cross-tenant, cross-actor, and malformed references', async () => {
    const fixture = application();
    const issued = await fixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    const grantToken = issued.grantToken ?? '';
    await fixture.service.consume({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken,
      resourceReference: 'item-a',
    });
    await expect(
      fixture.service.consume({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken,
        resourceReference: 'item-a',
      }),
    ).rejects.toEqual(new PrivacyAccessApplicationError());

    for (const command of [
      {
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actorId: ACTOR_ID,
        grantToken,
      },
      {
        workspaceId: WORKSPACE_ID,
        actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        grantToken,
      },
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken,
        resourceReference: 'line\nbreak',
      },
    ]) {
      await expect(fixture.service.consume(command)).rejects.toEqual(
        new PrivacyAccessApplicationError(),
      );
    }
  });

  it('uses a stable digest for absent and normalized resource references', async () => {
    const firstFixture = application();
    const first = await firstFixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    await firstFixture.service.consume({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken: first.grantToken ?? '',
    });
    const secondFixture = application();
    const second = await secondFixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    await secondFixture.service.consume({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken: second.grantToken ?? '',
      resourceReference: undefined,
    });
    expect(
      firstFixture.repository.consumed[0]?.resourceReferenceDigest,
    ).toBe(secondFixture.repository.consumed[0]?.resourceReferenceDigest);
  });
});

describe('authorized original personal data reader', () => {
  it('returns exact original Unicode PII only after successful grant consumption', async () => {
    const fixture = application();
    const issued = await fixture.service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason: 'Support case SUP-8841 requires exact profile verification.',
    });
    const profile = Object.freeze({
      displayName: '배성호',
      postalAddress: '대한민국 경기도 평택시 Example-ro １７',
      phoneNumber: '+82-10-1234-5678',
      emailAddress: 'person@example.test',
    });
    const reader: AuthorizedPersonalDataReader<typeof profile> = {
      read: vi.fn(async (receipt) => {
        expect(receipt.resourceCategory).toBe('identity_profile');
        return profile;
      }),
    };

    const returned = await readOriginalPersonalData(
      fixture.service,
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken: issued.grantToken ?? '',
        resourceReference: 'profile-primary',
      },
      reader,
    );

    expect(returned).toBe(profile);
    expect(returned).toEqual(profile);
    expect(reader.read).toHaveBeenCalledOnce();
    const evidence = JSON.stringify({
      decisions: fixture.repository.persisted,
      events: fixture.repository.consumed,
    });
    for (const value of Object.values(profile)) {
      expect(evidence).not.toContain(value);
    }
  });

  it('never calls the personal-data reader after denied consumption', async () => {
    const fixture = application();
    const reader: AuthorizedPersonalDataReader<{ displayName: string }> = {
      read: vi.fn(async () => ({ displayName: 'should-not-run' })),
    };
    await expect(
      readOriginalPersonalData(
        fixture.service,
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          grantToken: 'invalid',
        },
        reader,
      ),
    ).rejects.toEqual(new PrivacyAccessApplicationError());
    expect(reader.read).not.toHaveBeenCalled();
  });
});
