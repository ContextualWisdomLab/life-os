import {
  CredentialFreeJsonLogger,
  PrometheusHttpMetrics,
  getRequestContext,
} from '@life-os/observability';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayObservabilityMiddleware } from './observability';

const VALID_CORRELATION_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const GENERATED_CORRELATION_ID = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const FIXED_TIMESTAMP = '2026-08-03T19:30:00.000Z';

type ResponseEvent = 'finish' | 'close';

class FakeResponse {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  private readonly listeners = new Map<ResponseEvent, () => void>();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  once(event: ResponseEvent, listener: () => void): void {
    this.listeners.set(event, listener);
  }

  finish(statusCode: number): void {
    this.statusCode = statusCode;
    this.listeners.get('finish')?.();
  }

  close(): void {
    this.listeners.get('close')?.();
  }
}

function request(path: string, correlationId?: string) {
  return {
    method: 'GET',
    path,
    headers: correlationId
      ? { 'x-correlation-id': correlationId }
      : Object.create(null),
  };
}

function createLogger(lines: string[]): CredentialFreeJsonLogger {
  return new CredentialFreeJsonLogger({
    serviceName: 'life-os-gateway',
    write: (line) => lines.push(line),
    wallClock: () => FIXED_TIMESTAMP,
  });
}

function parsedLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('gateway observability middleware', () => {
  it('propagates context and records one bounded completion', () => {
    const lines: string[] = [];
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const clock = [1000, 1250];
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      createLogger(lines),
      () => clock.shift() ?? 1250,
    );
    const response = new FakeResponse();
    const next = vi.fn(() => {
      expect(getRequestContext()?.correlationId).toBe(VALID_CORRELATION_ID);
    });

    middleware(request('/v1/today', VALID_CORRELATION_ID), response, next);
    response.finish(503);
    response.close();

    expect(next).toHaveBeenCalledOnce();
    expect(getRequestContext()).toBeUndefined();
    expect(response.headers.get('x-correlation-id')).toBe(VALID_CORRELATION_ID);
    expect(metrics.renderPrometheus()).toContain(
      'route="/v1/today",status_class="5xx"} 1',
    );
    expect(metrics.renderPrometheus()).not.toContain('status_class="4xx"} 1');
    expect(parsedLines(lines)).toEqual([
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'error',
        event: 'http.request.completed',
        service: 'life-os-gateway',
        correlation_id: VALID_CORRELATION_ID,
        method: 'GET',
        route: '/v1/today',
        status_code: 503,
        status_class: '5xx',
        duration_seconds: 0.25,
      },
    ]);
  });

  it('replaces invalid input and collapses unknown concrete paths', () => {
    const lines: string[] = [];
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      () => GENERATED_CORRELATION_ID,
      createLogger(lines),
      () => 1000,
    );
    const response = new FakeResponse();
    const concretePath = '/v1/tasks/018f47b2-c1d2-4a30-8c17-221fb579c042';

    middleware(
      request(concretePath, 'token=secret'),
      response,
      () => undefined,
    );
    response.finish(404);

    const output = metrics.renderPrometheus();
    const serializedLogs = lines.join('\n');
    expect(response.headers.get('x-correlation-id')).toBe(
      GENERATED_CORRELATION_ID,
    );
    expect(output).toContain('route="/unmatched",status_class="4xx"} 1');
    expect(serializedLogs).toContain('"route":"/unmatched"');
    expect(output).not.toContain(concretePath);
    expect(serializedLogs).not.toContain(concretePath);
    expect(serializedLogs).not.toContain('token=secret');
  });

  it('finalizes an aborted response as a client-closed request', () => {
    const lines: string[] = [];
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      createLogger(lines),
      () => 1000,
    );
    const response = new FakeResponse();

    middleware(request('/v1/today'), response, () => undefined);
    response.close();

    const output = metrics.renderPrometheus();
    expect(output).toContain('route="/v1/today",status_class="4xx"} 1');
    expect(output).toContain(
      'life_os_http_in_flight_requests{service="life-os-gateway"} 0',
    );
    expect(parsedLines(lines)[0]).toMatchObject({
      level: 'warn',
      event: 'http.request.completed',
      status_code: 499,
      status_class: '4xx',
    });
  });

  it('emits a sanitized record and completes when metrics fail', () => {
    const lines: string[] = [];
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
      maxSeries: 1,
    });
    metrics.observeHttpRequest({
      method: 'POST',
      route: '/v1/today',
      statusCode: 200,
      durationSeconds: 0.1,
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      createLogger(lines),
      () => 1000,
    );
    const response = new FakeResponse();

    middleware(request('/v1/today'), response, () => undefined);
    expect(() => response.finish(200)).not.toThrow();

    expect(parsedLines(lines)).toEqual([
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'error',
        event: 'observability.failure',
        service: 'life-os-gateway',
        correlation_id: response.headers.get('x-correlation-id'),
        operation: 'metrics.record',
      },
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'info',
        event: 'http.request.completed',
        service: 'life-os-gateway',
        correlation_id: response.headers.get('x-correlation-id'),
        method: 'GET',
        route: '/v1/today',
        status_code: 200,
        status_class: '2xx',
        duration_seconds: 0,
      },
    ]);
    expect(lines.join('\n')).not.toMatch(/series limit|stack|message|secret/i);
    expect(metrics.renderPrometheus()).toContain(
      'life_os_http_in_flight_requests{service="life-os-gateway"} 0',
    );
  });

  it('isolates structured-log writer failures from response finalization', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const logger = new CredentialFreeJsonLogger({
      serviceName: 'life-os-gateway',
      write: () => {
        throw new Error('writer unavailable');
      },
      wallClock: () => FIXED_TIMESTAMP,
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      logger,
      () => 1000,
    );
    const response = new FakeResponse();

    middleware(request('/v1/health'), response, () => undefined);
    expect(() => response.finish(200)).not.toThrow();
    expect(metrics.renderPrometheus()).toContain(
      'route="/v1/health",status_class="2xx"} 1',
    );
  });

  it('records synchronous middleware failures once and rethrows', () => {
    const lines: string[] = [];
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      createLogger(lines),
      () => 1000,
    );
    const response = new FakeResponse();

    expect(() =>
      middleware(request('/v1/health'), response, () => {
        throw new Error('synthetic failure');
      }),
    ).toThrow('synthetic failure');
    response.finish(200);

    const output = metrics.renderPrometheus();
    expect(output).toContain('route="/v1/health",status_class="5xx"} 1');
    expect(output).not.toContain('status_class="2xx"} 1');
    expect(parsedLines(lines)).toHaveLength(1);
    expect(parsedLines(lines)[0]).toMatchObject({
      event: 'http.request.completed',
      status_code: 500,
      status_class: '5xx',
    });
    expect(lines.join('\n')).not.toContain('synthetic failure');
  });
});
