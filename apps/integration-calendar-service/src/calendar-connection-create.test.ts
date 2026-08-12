import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarConnectionCreateApplication,
  CalendarConnectionCreateDependencyError,
  CalendarConnectionCreateValidationError,
  type CalendarConnectionCredentialStore,
  type CalendarConnectionCreateRepository,
} from './calendar-connection-create';
import type { CalendarConnectionRecord } from './calendar-connection-repository';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-12T01:15:00.000Z';
const EXPIRES_AT = '2026-08-12T02:15:00.000Z';
const ACCESS_HANDLE = 'kms://calendar/access/opaque-1';
const REFRESH_HANDLE = 'kms://calendar/refresh/opaque-2';
const ACCESS_TOKEN = randomBytes(24).toString('base64url');
const REFRESH_TOKEN = randomBytes(24).toString('base64url');

const authority = Object.freeze({ workspaceId: WORKSPACE_ID, userId: USER_ID });
const providerResult = Object.freeze({
  connectionId: CONNECTION_ID,
  providerCode: 'google' as const,
  providerAccountSubject: 'google-subject-123',
  scopeValues: ['calendar.events.readonly'],
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  tokenExpiresAt: EXPIRES_AT,
  selectedCalendarIdentifier: 'primary',
});

function record(): CalendarConnectionRecord {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    providerCode: 'google',
    providerAccountSubject: 'google-subject-123',
    scopeValues: ['calendar.events.readonly'],
    accessSecretHandle: ACCESS_HANDLE,
    refreshSecretHandle: REFRESH_HANDLE,
    tokenExpiresAt: EXPIRES_AT,
    selectedCalendarIdentifier: 'primary',
    status: 'active',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    revokedAt: null,
  });
}

function store(): CalendarConnectionCredentialStore {
  return {
    writeSecret: vi
      .fn()
      .mockResolvedValueOnce(ACCESS_HANDLE)
      .mockResolvedValueOnce(REFRESH_HANDLE),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
  };
}

function repository(): CalendarConnectionCreateRepository {
  return { createConnection: vi.fn().mockResolvedValue(record()) };
}

describe('CalendarConnectionCreateApplication', () => {
  it('derives ownership only from trusted authority, stores secrets before metadata, and returns no secret material', async () => {
    const calls: string[] = [];
    const credentials: CalendarConnectionCredentialStore = {
      async writeSecret(input) {
        calls.push(`secret:${input.credentialKind}`);
        expect(input.workspaceId).toBe(WORKSPACE_ID);
        expect(input.userId).toBe(USER_ID);
        expect(input.connectionId).toBe(CONNECTION_ID);
        return input.credentialKind === 'access' ? ACCESS_HANDLE : REFRESH_HANDLE;
      },
      async deleteSecret() {
        calls.push('cleanup');
      },
    };
    const connections: CalendarConnectionCreateRepository = {
      async createConnection(input) {
        calls.push('metadata');
        expect(input.workspaceId).toBe(WORKSPACE_ID);
        expect(input.userId).toBe(USER_ID);
        expect(input.accessSecretHandle).toBe(ACCESS_HANDLE);
        expect(input.refreshSecretHandle).toBe(REFRESH_HANDLE);
        expect(input).not.toHaveProperty('accessToken');
        expect(input).not.toHaveProperty('refreshToken');
        return record();
      },
    };
    const application = new CalendarConnectionCreateApplication(
      connections,
      credentials,
      () => CREATED_AT,
    );

    const result = await application.create(authority, {
      ...providerResult,
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    } as never);

    expect(calls).toEqual(['secret:access', 'secret:refresh', 'metadata']);
    expect(result).toEqual({
      connectionId: CONNECTION_ID,
      providerCode: 'google',
      scopeValues: ['calendar.events.readonly'],
      tokenExpiresAt: EXPIRES_AT,
      selectedCalendarIdentifier: 'primary',
      status: 'active',
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('accessSecretHandle');
    expect(result).not.toHaveProperty('refreshSecretHandle');
  });

  it('deletes every newly stored credential if durable metadata creation fails', async () => {
    const credentials = store();
    const connections: CalendarConnectionCreateRepository = {
      async createConnection() {
        throw new Error('database unavailable');
      },
    };
    const application = new CalendarConnectionCreateApplication(
      connections,
      credentials,
      () => CREATED_AT,
    );

    await expect(application.create(authority, providerResult)).rejects.toBeInstanceOf(
      CalendarConnectionCreateDependencyError,
    );
    expect(credentials.deleteSecret).toHaveBeenCalledTimes(2);
    expect(credentials.deleteSecret).toHaveBeenCalledWith(REFRESH_HANDLE);
    expect(credentials.deleteSecret).toHaveBeenCalledWith(ACCESS_HANDLE);
  });

  it('deletes the access credential when refresh credential storage fails', async () => {
    const credentials: CalendarConnectionCredentialStore = {
      writeSecret: vi
        .fn()
        .mockResolvedValueOnce(ACCESS_HANDLE)
        .mockRejectedValueOnce(new Error('kms unavailable')),
      deleteSecret: vi.fn().mockResolvedValue(undefined),
    };
    const connections = repository();
    const application = new CalendarConnectionCreateApplication(
      connections,
      credentials,
      () => CREATED_AT,
    );

    await expect(application.create(authority, providerResult)).rejects.toBeInstanceOf(
      CalendarConnectionCreateDependencyError,
    );
    expect(credentials.deleteSecret).toHaveBeenCalledTimes(1);
    expect(credentials.deleteSecret).toHaveBeenCalledWith(ACCESS_HANDLE);
    expect(connections.createConnection).not.toHaveBeenCalled();
  });

  it('fails closed when compensating credential deletion cannot be proven', async () => {
    const credentials: CalendarConnectionCredentialStore = {
      writeSecret: vi
        .fn()
        .mockResolvedValueOnce(ACCESS_HANDLE)
        .mockResolvedValueOnce(REFRESH_HANDLE),
      deleteSecret: vi.fn().mockRejectedValue(new Error('kms cleanup unavailable')),
    };
    const connections: CalendarConnectionCreateRepository = {
      async createConnection() {
        throw new Error('database unavailable');
      },
    };
    const application = new CalendarConnectionCreateApplication(
      connections,
      credentials,
      () => CREATED_AT,
    );

    await expect(application.create(authority, providerResult)).rejects.toBeInstanceOf(
      CalendarConnectionCreateDependencyError,
    );
    expect(credentials.deleteSecret).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed provider results before storing credential material', async () => {
    const credentials = store();
    const connections = repository();
    const application = new CalendarConnectionCreateApplication(
      connections,
      credentials,
      () => CREATED_AT,
    );

    await expect(
      application.create(authority, {
        ...providerResult,
        connectionId: 'not-a-uuid',
      }),
    ).rejects.toBeInstanceOf(CalendarConnectionCreateValidationError);
    expect(credentials.writeSecret).not.toHaveBeenCalled();
    expect(connections.createConnection).not.toHaveBeenCalled();
  });
});
