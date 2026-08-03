import { PrometheusHttpMetrics } from '@life-os/observability';
import { describe, expect, it, vi } from 'vitest';
import { createPlanningObservabilityMiddleware } from './observability';

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

function request(method: string, path: string, correlationId?: string) {
  return {
    method,
    path,
    headers: correlationId
      ? { 'x-correlation-id': correlationId }
      : Object.create(null),
  };
}

describe('planning observability middleware', () => {
  it('preserves correlation and records concrete goal paths as templates', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-planning-service',
    });
    const middleware = createPlanningObservabilityMiddleware(metrics);
    const response = new FakeResponse();
    const goalId = '018f47b2-c1d2-4a30-8c17-221fb579c042';

    middleware(
      request('POST', `/v1/goals/${goalId}/projects`, VALID_CORRELATION_ID),
      response,
      () => undefined,
    );
    response.finish(201);

    const output = metrics.renderPrometheus();
    expect(response.headers.get('x-correlation-id')).toBe(VALID_CORRELATION_ID);
    expect(output).toContain(
      'route="/v1/goals/:goal_id/projects",status_class="2xx"} 1',
    );
    expect(output).not.toContain(goalId);
  });

  it('replaces invalid correlation input and collapses unknown paths', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-planning-service',
    });
    const middleware = createPlanningObservabilityMiddleware(
      metrics,
      () => GENERATED_CORRELATION_ID,
    );
    const response = new FakeResponse();
    const concretePath = '/v1/private/workspaces/customer-secret';

    middleware(
      request('GET', concretePath, 'credential=secret'),
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

  it('finalizes an aborted request once when close and finish both fire', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-planning-service',
    });
    const middleware = createPlanningObservabilityMiddleware(metrics);
    const response = new FakeResponse();

    middleware(request('GET', '/v1/projects/project_key/tasks'), response, () =>
      undefined,
    );
    response.close();
    response.finish(200);

    const output = metrics.renderPrometheus();
    expect(output).toContain(
      'route="/v1/projects/:project_id/tasks",status_class="4xx"} 1',
    );
    expect(output).not.toContain('status_class="2xx"} 1');
    expect(output).toContain(
      'life_os_http_in_flight_requests{service="life-os-planning-service"} 0',
    );
  });

  it('isolates unsupported request methods from the service pipeline', () => {
    const metrics = new PrometheusHttpMetrics({
      serviceName: 'life-os-planning-service',
    });
    const reportMetricFailure = vi.fn();
    const middleware = createPlanningObservabilityMiddleware(
      metrics,
      undefined,
      reportMetricFailure,
    );
    const response = new FakeResponse();
    const next = vi.fn();

    middleware(request('TRACE', '/v1/goals'), response, next);
    response.finish(200);

    expect(next).toHaveBeenCalledOnce();
    expect(reportMetricFailure).toHaveBeenCalledOnce();
    expect(metrics.renderPrometheus()).not.toContain(
      'life_os_http_requests_total{',
    );
  });
});
