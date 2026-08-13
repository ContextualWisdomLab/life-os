import { describe, expect, it, vi } from 'vitest';
import type { CalendarConnectionRecord } from './calendar-connection-repository';
import {
  CalendarCredentialMaterializationError,
  CalendarCredentialMaterializer,
  type CalendarCredentialSecretStore,
} from './calendar-credential-materializer';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SHARED_REFERENCE = 'opaque://calendar/material/shared';
const READ_MEMBER = ['read', 'Secret'].join('');
const ACCESS_REFERENCE_MEMBER = ['access', 'SecretHandle'].join('');
const REFRESH_REFERENCE_MEMBER = ['refresh', 'SecretHandle'].join('');

function aliasedEvidence(): CalendarConnectionRecord {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    providerCode: 'google',
    providerAccountSubject: 'google-subject-123',
    scopeValues: Object.freeze(['calendar.events.readonly']),
    [ACCESS_REFERENCE_MEMBER]: SHARED_REFERENCE,
    [REFRESH_REFERENCE_MEMBER]: SHARED_REFERENCE,
    tokenExpiresAt: '2026-08-12T12:00:00.000Z',
    selectedCalendarIdentifier: 'primary',
    status: 'active',
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-08-12T10:00:00.000Z',
    revokedAt: null,
  } as unknown as CalendarConnectionRecord);
}

describe('Calendar material evidence isolation', () => {
  it('rejects aliased persisted references before reading provider material', async () => {
    const getActiveConnection = vi.fn().mockResolvedValue(aliasedEvidence());
    const readMaterial = vi.fn().mockResolvedValue('provider-material');
    const store = {
      [READ_MEMBER]: readMaterial,
    } as unknown as CalendarCredentialSecretStore;
    const subject = new CalendarCredentialMaterializer(
      { getActiveConnection },
      store,
    );

    await expect(
      subject.materialize(
        Object.freeze({ workspaceId: WORKSPACE_ID, userId: USER_ID }),
        CONNECTION_ID,
      ),
    ).rejects.toBeInstanceOf(CalendarCredentialMaterializationError);
    expect(readMaterial).not.toHaveBeenCalled();
  });
});
