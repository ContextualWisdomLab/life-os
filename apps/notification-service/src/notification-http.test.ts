import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapNotificationService,
  createNotificationRequestListener,
  type NotificationHttpRequest,
  type NotificationHttpResponse,
  type NotificationHttpServer,
} from './notification-http';
import type { NotificationRuntime } from './notification-runtime';

/** Creates a bounded runtime fixture without opening PostgreSQL connections. */
function runtime(): NotificationRuntime {
  return {
    close: vi.fn(async () => undefined),
    dataRightsAuthorityReplayGuard: {},
    dataRightsContributor: {},
  } as unknown as NotificationRuntime;
}

/** Creates one async-iterable HTTP request with no socket dependency. */
function request(options: {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string | string[]>>;
  readonly body?: string;
}): NotificationHttpRequest {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body)];
  return {
    method: options.method,
    url: options.url,
    headers: { ...(options.headers ?? {}) },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

/** Captures status, headers, and JSON body written by the private adapter. */
function response(): NotificationHttpResponse & {
  readonly headers: Map<string, string>;
  body?: string;
} {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(body) {
      this.body = body;
    },
  };
}

/** Creates a deterministic mock server whose listener bind succeeds or fails on demand. */
function server(failListen = false): NotificationHttpServer & {
  readonly listenCalls: Array<readonly [number, string]>;
  closeCalls: number;
} {
  let errorListener: ((error: Error) => void) | undefined;
  const listenCalls: Array<readonly [number, string]> = [];
  return {
    listenCalls,
    closeCalls: 0,
    once(_event, listener) {
      errorListener = listener;
      return this;
    },
    off(_event, listener) {
      if (errorListener === listener) errorListener = undefined;
      return this;
    },
    listen(port, host, listener) {
      listenCalls.push([port, host]);
      if (failListen) {
        errorListener?.(new Error('socket detail must not escape'));
      } else {
        listener();
      }
      return this;
    },
    close(listener) {
      this.closeCalls += 1;
      listener();
      return this;
    },
  };
}

describe('Notification internal HTTP composition', () => {
  it('routes one bounded JSON request to the authenticated contributor handler', async () => {
    const contribute = vi.fn(async () => ({ operation: 'verify_erased', erased: true }));
    const listener = createNotificationRequestListener({ contribute });
    const outgoing = response();
    const body = JSON.stringify({ contractVersion: 'life-os.data-rights-contributor.v1' });

    await listener(
      request({
        method: 'POST',
        url: '/v1/internal/data-rights/contributor',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(Buffer.byteLength(body)),
          'x-life-os-data-rights-issued-at': '1786334400',
          'x-life-os-data-rights-signature': 'signature',
        },
        body,
      }),
      outgoing,
    );

    expect(contribute).toHaveBeenCalledWith(
      '1786334400',
      'signature',
      {
        method: 'POST',
        originalUrl: '/v1/internal/data-rights/contributor',
      },
      { contractVersion: 'life-os.data-rights-contributor.v1' },
    );
    expect(outgoing.statusCode).toBe(200);
    expect(outgoing.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(outgoing.body ?? '')).toEqual({
      operation: 'verify_erased',
      erased: true,
    });
  });

  it('rejects unknown resources, wrong methods, duplicate authority headers, and malformed bodies without reflection', async () => {
    const contribute = vi.fn(async () => {
      throw new HttpException(
        { type: 'about:blank', title: 'invalid', status: 401, code: 'invalid_context' },
        401,
      );
    });
    const listener = createNotificationRequestListener({ contribute });

    const notFound = response();
    await listener(request({ method: 'POST', url: '/other', headers: {} }), notFound);
    expect(notFound.statusCode).toBe(404);

    const wrongMethod = response();
    await listener(
      request({ method: 'GET', url: '/v1/internal/data-rights/contributor', headers: {} }),
      wrongMethod,
    );
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');

    const invalidMedia = response();
    await listener(
      request({
        method: 'POST',
        url: '/v1/internal/data-rights/contributor',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
      invalidMedia,
    );
    expect(invalidMedia.statusCode).toBe(415);

    const oversized = response();
    await listener(
      request({
        method: 'POST',
        url: '/v1/internal/data-rights/contributor',
        headers: { 'content-type': 'application/json', 'content-length': '65537' },
        body: '{}',
      }),
      oversized,
    );
    expect(oversized.statusCode).toBe(413);

    const malformed = response();
    await listener(
      request({
        method: 'POST',
        url: '/v1/internal/data-rights/contributor',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      malformed,
    );
    expect(malformed.statusCode).toBe(400);

    const duplicateHeader = response();
    await listener(
      request({
        method: 'POST',
        url: '/v1/internal/data-rights/contributor',
        headers: {
          'content-type': 'application/json',
          'x-life-os-data-rights-signature': ['one', 'two'],
        },
        body: '{}',
      }),
      duplicateHeader,
    );
    expect(duplicateHeader.statusCode).toBe(401);
    expect(JSON.stringify(duplicateHeader.body)).not.toContain('one');
  });

  it('boots and closes the private listener around the durable runtime', async () => {
    const suppliedRuntime = runtime();
    const suppliedServer = server();
    const service = await bootstrapNotificationService(
      {
        NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
        NOTIFICATION_PORT: '4300',
        NOTIFICATION_HOST: '127.0.0.1',
      },
      () => suppliedRuntime,
      () => suppliedServer,
    );

    expect(suppliedServer.listenCalls).toEqual([[4300, '127.0.0.1']]);
    await service.close();
    expect(suppliedServer.closeCalls).toBe(1);
    expect(suppliedRuntime.close).toHaveBeenCalledTimes(1);
  });

  it('defaults the private contributor listener to loopback', async () => {
    const suppliedRuntime = runtime();
    const suppliedServer = server();
    const service = await bootstrapNotificationService(
      {
        NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
        NOTIFICATION_PORT: '4300',
      },
      () => suppliedRuntime,
      () => suppliedServer,
    );

    expect(suppliedServer.listenCalls).toEqual([[4300, '127.0.0.1']]);
    await service.close();
  });

  it.each([
    [{ NOTIFICATION_PORT: '0' }, 'Notification port is invalid'],
    [{ NOTIFICATION_PORT: '65536' }, 'Notification port is invalid'],
    [{ NOTIFICATION_PORT: '4.3e3' }, 'Notification port is invalid'],
    [{ NOTIFICATION_HOST: '' }, 'Notification host is invalid'],
    [{ NOTIFICATION_HOST: ' host ' }, 'Notification host is invalid'],
  ])('rejects unsafe listener configuration before runtime creation', async (override, expected) => {
    const runtimeFactory = vi.fn(() => runtime());
    const serverFactory = vi.fn(() => server());

    await expect(
      bootstrapNotificationService(
        {
          NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
          ...override,
        },
        runtimeFactory,
        serverFactory,
      ),
    ).rejects.toThrow(expected);
    expect(runtimeFactory).not.toHaveBeenCalled();
    expect(serverFactory).not.toHaveBeenCalled();
  });

  it('closes durable resources and sanitizes listener startup failure', async () => {
    const suppliedRuntime = runtime();
    await expect(
      bootstrapNotificationService(
        { NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os' },
        () => suppliedRuntime,
        () => server(true),
      ),
    ).rejects.toThrow(/^Notification HTTP bootstrap failed$/u);
    expect(suppliedRuntime.close).toHaveBeenCalledTimes(1);
  });
});
