import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { DataRightsRequestValidationError } from './data-rights-request-ledger';

const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

class TestResponse {
  statusCode = 0;
  contentType = '';
  readonly headers = new Map<string, string>();
  body: unknown;

  status(statusCode: number): TestResponse {
    this.statusCode = statusCode;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  type(contentType: string): TestResponse {
    this.contentType = contentType;
    return this;
  }

  send(body?: unknown): TestResponse {
    this.body = body;
    return this;
  }
}

async function controllerModule(): Promise<Readonly<Record<string, unknown>>> {
  const modulePath = './data-rights-http-controller';
  return import(modulePath).catch(() => ({}));
}

describe('DataRightsHttpController', () => {
  it('publishes one authenticated request-status resource', async () => {
    const module = await controllerModule();
    const Controller = module.DataRightsHttpController as {
      prototype: { getRequestStatus: unknown };
    };
    expect(typeof Controller).toBe('function');
    expect(
      Reflect.getMetadata(PATH_METADATA, Controller.prototype.getRequestStatus),
    ).toBe('v1/data-rights/requests/:requestId');
  });

  it('returns only bounded credential-free request status and disables caching', async () => {
    const module = await controllerModule();
    const Controller = module.DataRightsHttpController as new (application: {
      getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown>;
    }) => {
      getRequestStatus(
        requestId: string,
        cookie: string | undefined,
        response: TestResponse,
      ): Promise<void>;
    };
    expect(typeof Controller).toBe('function');
    const getRequestStatus = vi.fn().mockResolvedValue({
      schemaVersion: 'life-os.data-rights-request-status.v1',
      requestId: REQUEST_ID,
      requestKind: 'erasure',
      status: 'pending',
      requestedAt: '2026-08-10T00:01:00.000Z',
      completedAt: null,
    });
    const controller = new Controller({ getRequestStatus });
    const response = new TestResponse();

    await controller.getRequestStatus(
      REQUEST_ID,
      'life_os_session=opaque',
      response,
    );

    expect(getRequestStatus).toHaveBeenCalledWith(
      'life_os_session=opaque',
      REQUEST_ID,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.statusCode).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(response.body).toEqual({
      schemaVersion: 'life-os.data-rights-request-status.v1',
      requestId: REQUEST_ID,
      requestKind: 'erasure',
      status: 'pending',
      requestedAt: '2026-08-10T00:01:00.000Z',
      completedAt: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('workspaceId');
    expect(JSON.stringify(response.body)).not.toContain('idempotency');
    expect(JSON.stringify(response.body)).not.toContain('Digest');
  });

  it.each([
    [new Error('Session is invalid or expired'), 401, 'authentication_required'],
    [new DataRightsRequestValidationError(), 400, 'invalid_data_rights_request'],
  ] as const)(
    'maps bounded client failures without leaking diagnostics',
    async (error, expectedStatus, expectedCode) => {
      const module = await controllerModule();
      const Controller = module.DataRightsHttpController as new (application: {
        getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown>;
      }) => {
        getRequestStatus(
          requestId: string,
          cookie: string | undefined,
          response: TestResponse,
        ): Promise<void>;
      };
      expect(typeof Controller).toBe('function');
      const controller = new Controller({
        getRequestStatus: vi.fn().mockRejectedValue(error),
      });
      const response = new TestResponse();

      await controller.getRequestStatus(REQUEST_ID, undefined, response);

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.contentType).toBe('application/problem+json');
      expect(response.body).toMatchObject({
        type: 'about:blank',
        status: expectedStatus,
        code: expectedCode,
      });
      expect(JSON.stringify(response.body)).not.toContain(error.message);
    },
  );

  it('conceals absent and cross-tenant request identities behind the same 404', async () => {
    const module = await controllerModule();
    const Controller = module.DataRightsHttpController as new (application: {
      getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown>;
    }) => {
      getRequestStatus(
        requestId: string,
        cookie: string | undefined,
        response: TestResponse,
      ): Promise<void>;
    };
    const NotFound = module.DataRightsRequestNotFoundError as new () => Error;
    expect(typeof Controller).toBe('function');
    expect(typeof NotFound).toBe('function');
    const controller = new Controller({
      getRequestStatus: vi.fn().mockRejectedValue(new NotFound()),
    });
    const response = new TestResponse();

    await controller.getRequestStatus(REQUEST_ID, undefined, response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Data-rights request was not found',
      status: 404,
      code: 'data_rights_request_not_found',
    });
  });

  it('redacts unexpected persistence diagnostics behind service unavailability', async () => {
    const module = await controllerModule();
    const Controller = module.DataRightsHttpController as new (application: {
      getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown>;
    }) => {
      getRequestStatus(
        requestId: string,
        cookie: string | undefined,
        response: TestResponse,
      ): Promise<void>;
    };
    expect(typeof Controller).toBe('function');
    const controller = new Controller({
      getRequestStatus: vi
        .fn()
        .mockRejectedValue(new Error('postgres password=secret-token')),
    });
    const response = new TestResponse();

    await controller.getRequestStatus(REQUEST_ID, undefined, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Identity service is unavailable',
      status: 503,
      code: 'identity_service_unavailable',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-token');
  });
});
