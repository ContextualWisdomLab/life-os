import { PrometheusHttpMetrics } from '@life-os/observability';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayObservabilityMiddleware } from './observability';

const VALID_CORRELATION_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const GENERATED_CORRELATION_ID = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';

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

describe('gateway observability middleware', () => {
  it('preserves a valid correlation ID and records the bounded route once', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(metrics);
    const response = new FakeResponse();
    const next = vi.fn();

    middleware(request('/v1/today', VALID_CORRELATION_ID), response, next);
    response.finish(503);
    response.close();

    expect(next).toHaveBeenCalledOnce();
    expect(response.headers.get('x-correlation-id')).toBe(VALID_CORRELATION_ID);
    expect(metrics.renderPrometheus()).toContain(
      'route="/v1/today",status_class="5xx"} 1',
    );
    expect(metrics.renderPrometheus()).not.toContain('status_class="4xx"} 1');
  });

  it('replaces invalid input and collapses unknown concrete paths', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      () => GENERATED_CORRELATION_ID,
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
    expect(response.headers.get('x-correlation-id')).toBe(
      GENERATED_CORRELATION_ID,
    );
    expect(output).toContain('route="/unmatched",status_class="4xx"} 1');
    expect(output).not.toContain(concretePath);
    expect(output).not.toContain('secret');
  });

  it('finalizes an aborted response as a client-closed request', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(metrics);
    const response = new FakeResponse();

    middleware(request('/v1/today'), response, () => undefined);
    response.close();

    const output = metrics.renderPrometheus();
    expect(output).toContain('route="/v1/today",status_class="4xx"} 1');
    expect(output).toContain(
      'life_os_http_in_flight_requests{service="life-os-gateway"} 0',
    );
  });

  it('isolates metric failures from response finalization', () => {
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
    const reportMetricFailure = vi.fn();
    const middleware = createGatewayObservabilityMiddleware(
      metrics,
      undefined,
      reportMetricFailure,
    );
    const response = new FakeResponse();

    middleware(request('/v1/today'), response, () => undefined);
    expect(() => response.finish(200)).not.toThrow();

    expect(reportMetricFailure).toHaveBeenCalledOnce();
    expect(metrics.renderPrometheus()).toContain(
      'life_os_http_in_flight_requests{service="life-os-gateway"} 0',
    );
  });

  it('records synchronous middleware failures once and rethrows', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-gateway',
    });
    const middleware = createGatewayObservabilityMiddleware(metrics);
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
  });
});
