import {
  PrometheusHttpMetrics,
  normalizeCorrelationId,
} from '@life-os/observability';

interface GatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface GatewayResponse {
  readonly statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', listener: () => void): void;
}

type GatewayNext = () => void;
type CorrelationIdFactory = () => string;
type ObservabilityErrorReporter = (error: unknown) => void;

const BOUNDED_ROUTE_TEMPLATES = new Set([
  '/v1/health',
  '/v1/metrics',
  '/v1/today',
]);
const CLIENT_CLOSED_REQUEST_STATUS = 499;

/** Shared bounded metrics registry for the gateway process. */
export const gatewayMetrics = new PrometheusHttpMetrics({
  serviceName: 'life-os-gateway',
});

/** Maps concrete request paths to a fixed low-cardinality route inventory. */
function routeTemplate(path: string): string {
  return BOUNDED_ROUTE_TEMPLATES.has(path) ? path : '/unmatched';
}

/** Reads a single correlation header without accepting array-valued input. */
function correlationHeader(
  headers: GatewayRequest['headers'],
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

/**
 * Creates gateway middleware that emits bounded metrics and correlation IDs.
 * Metric failures are isolated, and aborted responses are finalized as 499.
 */
export function createGatewayObservabilityMiddleware(
  metrics: PrometheusHttpMetrics = gatewayMetrics,
  correlationIdFactory?: CorrelationIdFactory,
  reportMetricFailure: ObservabilityErrorReporter = () => undefined,
): (
  request: GatewayRequest,
  response: GatewayResponse,
  next: GatewayNext,
) => void {
  return (request, response, next) => {
    const correlationId = normalizeCorrelationId(
      correlationHeader(request.headers),
      correlationIdFactory,
    );
    response.setHeader('x-correlation-id', correlationId);

    const finish = metrics.beginHttpRequest({
      method: request.method,
      route: routeTemplate(request.path),
    });
    const recordCompletion = (statusCode: number): void => {
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

/** Default gateway observability middleware instance. */
export const gatewayObservabilityMiddleware =
  createGatewayObservabilityMiddleware();
