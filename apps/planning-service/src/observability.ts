import {
  PrometheusHttpMetrics,
  normalizeCorrelationId,
} from '@life-os/observability';

interface PlanningRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface PlanningResponse {
  readonly statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', listener: () => void): void;
}

type PlanningNext = () => void;
type CorrelationIdFactory = () => string;
type ObservabilityErrorReporter = (error: unknown) => void;
type RequestCompletion = (statusCode: number) => boolean;

const STATIC_ROUTE_TEMPLATES = new Set([
  '/v1/health',
  '/v1/metrics',
  '/v1/goals',
]);
const GOAL_PROJECTS_ROUTE = /^\/v1\/goals\/[^/]+\/projects$/;
const PROJECT_TASKS_ROUTE = /^\/v1\/projects\/[^/]+\/tasks$/;
const CLIENT_CLOSED_REQUEST_STATUS = 499;

/** Shared bounded metrics registry for the planning-service process. */
export const planningMetrics = new PrometheusHttpMetrics({
  serviceName: 'life-os-planning-service',
});

/** Maps concrete planning paths to a fixed low-cardinality route inventory. */
function routeTemplate(path: string): string {
  if (STATIC_ROUTE_TEMPLATES.has(path)) return path;
  if (GOAL_PROJECTS_ROUTE.test(path)) {
    return '/v1/goals/:goal_id/projects';
  }
  if (PROJECT_TASKS_ROUTE.test(path)) {
    return '/v1/projects/:project_id/tasks';
  }
  return '/unmatched';
}

/** Reads a single correlation header without accepting array-valued input. */
function correlationHeader(
  headers: PlanningRequest['headers'],
): string | undefined {
  const value = headers['x-correlation-id'];
  return typeof value === 'string' ? value : undefined;
}

/** Reports metric failures without allowing the reporter to break requests. */
function safelyReportMetricFailure(
  reporter: ObservabilityErrorReporter,
  error: unknown,
): void {
  try {
    reporter(error);
  } catch {
    // Observability must remain isolated from the request pipeline.
  }
}

/** Starts a request measurement or returns a safe no-op on invalid input. */
function beginMeasurement(
  metrics: PrometheusHttpMetrics,
  request: PlanningRequest,
  reporter: ObservabilityErrorReporter,
): RequestCompletion {
  try {
    return metrics.beginHttpRequest({
      method: request.method,
      route: routeTemplate(request.path),
    });
  } catch (error) {
    safelyReportMetricFailure(reporter, error);
    return () => false;
  }
}

/**
 * Creates planning-service middleware with bounded metrics and correlation IDs.
 * Metric failures are isolated, and aborted responses are finalized as 499.
 */
export function createPlanningObservabilityMiddleware(
  metrics: PrometheusHttpMetrics = planningMetrics,
  correlationIdFactory?: CorrelationIdFactory,
  reportMetricFailure: ObservabilityErrorReporter = () => undefined,
): (
  request: PlanningRequest,
  response: PlanningResponse,
  next: PlanningNext,
) => void {
  return (request, response, next) => {
    const correlationId = normalizeCorrelationId(
      correlationHeader(request.headers),
      correlationIdFactory,
    );
    response.setHeader('x-correlation-id', correlationId);

    const finish = beginMeasurement(metrics, request, reportMetricFailure);
    let completed = false;
    const recordCompletion = (statusCode: number): void => {
      if (completed) return;
      completed = true;
      try {
        finish(statusCode);
      } catch (error) {
        safelyReportMetricFailure(reportMetricFailure, error);
      }
    };
    response.once('finish', () => {
      recordCompletion(response.statusCode);
    });
    response.once('close', () => {
      recordCompletion(CLIENT_CLOSED_REQUEST_STATUS);
    });

    try {
      next();
    } catch (error) {
      recordCompletion(500);
      throw error;
    }
  };
}

/** Default planning-service observability middleware instance. */
export const planningObservabilityMiddleware =
  createPlanningObservabilityMiddleware();
