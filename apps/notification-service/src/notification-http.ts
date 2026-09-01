import { HttpException } from '@nestjs/common';
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import {
  NotificationDataRightsController,
  type NotificationDataRightsHttpRequestIdentity,
} from './notification-data-rights-controller';
import {
  createNotificationRuntime,
  type NotificationRuntime,
} from './notification-runtime';

const DEFAULT_NOTIFICATION_HOST = '127.0.0.1';
const DEFAULT_NOTIFICATION_PORT = 4300;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';
const MAXIMUM_REQUEST_BYTES = 64 * 1024;
const DECIMAL_PORT_PATTERN = /^[1-9]\d{0,4}$/u;
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9.:_-]+$/u;
const JSON_MEDIA_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;

/** Environment values accepted by the Notification HTTP composition root. */
export type NotificationHttpEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Minimal request shape consumed by the framework-free private HTTP adapter. */
export interface NotificationHttpRequest
  extends AsyncIterable<Uint8Array | string> {
  readonly method?: string;
  readonly url?: string;
  readonly headers: IncomingHttpHeaders;
}

/** Minimal response shape written by the private HTTP adapter. */
export interface NotificationHttpResponse {
  statusCode: number;
  /** Sets one bounded response header before the body is finalized. */
  setHeader(name: string, value: string): unknown;
  /** Finalizes the response with a UTF-8 JSON body. */
  end(body?: string): unknown;
}

/** Minimal server lifecycle required by the composition root and its tests. */
export interface NotificationHttpServer {
  /** Registers one startup error listener. */
  once(event: 'error', listener: (error: Error) => void): this;
  /** Removes the startup error listener after successful binding. */
  off(event: 'error', listener: (error: Error) => void): this;
  /** Binds the validated private listener. */
  listen(port: number, host: string, listener: () => void): this;
  /** Stops accepting new requests and closes the listener. */
  close(listener: (error?: Error) => void): this;
}

/** Factory boundary used to create an HTTP server around the validated request handler. */
export type NotificationHttpServerFactory = (
  listener: (
    request: NotificationHttpRequest,
    response: NotificationHttpResponse,
  ) => void,
) => NotificationHttpServer;

/** Factory boundary for the service-owned durable runtime. */
export type NotificationRuntimeFactory = (
  environment: NotificationHttpEnvironment,
) => NotificationRuntime;

/** Running listener and durable runtime that must close together. */
export interface NotificationHttpService {
  readonly server: NotificationHttpServer;
  readonly runtime: NotificationRuntime;
  /** Stops the listener before releasing the Notification-owned PostgreSQL pool. */
  close(): Promise<void>;
}

/** Request handler boundary used by the transport without exposing Nest decorators. */
export interface NotificationDataRightsHttpHandler {
  /** Handles one already-routed request through the authenticated contributor controller. */
  contribute(
    issuedAt: string | undefined,
    signature: string | undefined,
    request: NotificationDataRightsHttpRequestIdentity,
    body: unknown,
  ): Promise<unknown>;
}

/** Requires a decimal non-privileged TCP port before durable runtime construction. */
function notificationPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_NOTIFICATION_PORT;
  if (!DECIMAL_PORT_PATTERN.test(value)) {
    throw new Error('Notification port is invalid');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error('Notification port is invalid');
  }
  return parsed;
}

/** Requires one bounded host token without whitespace or shell/control characters. */
function notificationHost(value: string | undefined): string {
  if (value === undefined) return DEFAULT_NOTIFICATION_HOST;
  if (!HOST_PATTERN.test(value)) {
    throw new Error('Notification host is invalid');
  }
  return value;
}

/** Returns one singular request header without joining attacker-controlled duplicates. */
function singularHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** Writes a bounded JSON response with cache prevention for private data-rights evidence. */
function writeJson(
  response: NotificationHttpResponse,
  status: number,
  body: unknown,
  mediaType = 'application/json',
): void {
  response.statusCode = status;
  response.setHeader('content-type', `${mediaType}; charset=utf-8`);
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

/** Writes one transport problem without reflecting request or dependency details. */
function writeProblem(
  response: NotificationHttpResponse,
  status: number,
  title: string,
  code: string,
): void {
  writeJson(
    response,
    status,
    { type: 'about:blank', title, status, code },
    'application/problem+json',
  );
}

/** Reads one bounded JSON object body while refusing media-type ambiguity and oversized input. */
async function readJsonBody(request: NotificationHttpRequest): Promise<unknown> {
  const contentType = singularHeader(request.headers, 'content-type');
  if (contentType === undefined || !JSON_MEDIA_TYPE_PATTERN.test(contentType)) {
    throw new HttpException('unsupported media type', 415);
  }
  const contentLength = singularHeader(request.headers, 'content-length');
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new HttpException('invalid content length', 400);
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > MAXIMUM_REQUEST_BYTES) {
      throw new HttpException('request too large', 413);
    }
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > MAXIMUM_REQUEST_BYTES) {
      throw new HttpException('request too large', 413);
    }
    chunks.push(buffer);
  }
  if (received === 0) {
    throw new HttpException('invalid json', 400);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpException('invalid json', 400);
  }
}

/** Maps only known transport status into stable public problems; all other failures are generic 503. */
function writeTransportFailure(
  response: NotificationHttpResponse,
  error: unknown,
): void {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const problem = error.getResponse();
    if (typeof problem === 'object' && problem !== null) {
      writeJson(response, status, problem, 'application/problem+json');
      return;
    }
    if (status === 400 || status === 413 || status === 415) {
      const code =
        status === 413
          ? 'request_too_large'
          : status === 415
            ? 'unsupported_media_type'
            : 'invalid_request';
      writeProblem(response, status, 'Notification request is invalid', code);
      return;
    }
  }
  writeProblem(
    response,
    503,
    'Notification data-rights operation is unavailable',
    'data_rights_unavailable',
  );
}

/**
 * Creates the private HTTP adapter for the authenticated Notification contributor.
 *
 * Only one exact POST resource is exposed. The adapter bounds JSON before the
 * controller, does not join duplicate authority headers, never caches responses,
 * and delegates tenant/actor/signature/replay validation to the controller.
 */
export function createNotificationRequestListener(
  controller: NotificationDataRightsHttpHandler,
): (
  request: NotificationHttpRequest,
  response: NotificationHttpResponse,
) => Promise<void> {
  return async (request, response) => {
    if (request.url !== CONTRIBUTOR_PATH) {
      writeProblem(response, 404, 'Notification resource was not found', 'not_found');
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      writeProblem(response, 405, 'Notification method is not allowed', 'method_not_allowed');
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await controller.contribute(
        singularHeader(request.headers, 'x-life-os-data-rights-issued-at'),
        singularHeader(request.headers, 'x-life-os-data-rights-signature'),
        { method: request.method, originalUrl: request.url },
        body,
      );
      writeJson(response, 200, result);
    } catch (error) {
      writeTransportFailure(response, error);
    }
  };
}

/** Adapts Node's built-in HTTP server to the small testable lifecycle boundary. */
function defaultServerFactory(
  listener: (
    request: NotificationHttpRequest,
    response: NotificationHttpResponse,
  ) => void,
): NotificationHttpServer {
  return createServer((request, response) => {
    void listener(request, response);
  }) as Server as NotificationHttpServer;
}

/** Waits for one validated listener bind and rejects the exact startup attempt on socket error. */
async function listen(
  server: NotificationHttpServer,
  port: number,
  host: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      reject(new Error('Notification listener failed'));
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/** Closes the HTTP listener without reflecting operating-system socket details. */
async function closeServer(server: NotificationHttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(new Error('Notification listener close failed'));
        return;
      }
      resolve();
    });
  });
}

/**
 * Boots the deployable Notification HTTP process with no extra framework runtime.
 * Listener configuration is validated before PostgreSQL construction. Startup
 * failure closes service-owned resources. The returned close operation always
 * stops ingress before releasing the PostgreSQL pool.
 */
export async function bootstrapNotificationService(
  environment: NotificationHttpEnvironment = process.env,
  runtimeFactory: NotificationRuntimeFactory = createNotificationRuntime,
  serverFactory: NotificationHttpServerFactory = defaultServerFactory,
): Promise<NotificationHttpService> {
  const port = notificationPort(environment.NOTIFICATION_PORT);
  const host = notificationHost(environment.NOTIFICATION_HOST);
  const runtime = runtimeFactory(environment);
  const controller = new NotificationDataRightsController(runtime);
  const server = serverFactory(createNotificationRequestListener(controller));
  try {
    await listen(server, port, host);
  } catch {
    await runtime.close().catch(() => undefined);
    throw new Error('Notification HTTP bootstrap failed');
  }

  return {
    server,
    runtime,
    async close(): Promise<void> {
      try {
        await closeServer(server);
      } finally {
        await runtime.close();
      }
    },
  };
}
