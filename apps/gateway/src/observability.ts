import {
  CredentialFreeJsonLogger,
  PrometheusHttpMetrics,
  normalizeCorrelationId,
  runWithRequestContext,
  type ObservabilityOperation,
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
type MonotonicClock = () => number;

const BOUNDED_ROUTE_TEMPLATES = new Set([
  '/v1/health',
  '/v1/metrics',
  '/v1/today',
]);
const CLIENT_CLOSED_REQUEST_STATUS = 499;
const MAX_DURATION_SECONDS = 3600;

/** Shared bounded metrics registry for the gateway process. */
export const gatewayMetrics = new PrometheusHttpMetrics({
  serviceName: 'life-os-gateway',
});

/** Shared credential-free structured logger for the gateway process. */
export const gatewayLogger = new CredentialFreeJsonLogger({
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

/** Emits a sanitized failure record without allowing logging to break requests. */
function safelyLogObservabilityFailure(
  logger: CredentialFreeJsonLogger,
  correlationId: string,
  operation: ObservabilityOperation,
): void {
  try {
    logger.observabilityFailure({ correlationId, operation });
  } catch {
    // Observability must remain isolated from the request pipeline.
  }
}

/** Reads a finite monotonic timestamp or reports an unavailable clock. */
function safelyReadClock(
  now: MonotonicClock,
  logger: CredentialFreeJsonLogger,
  correlationId: string,
): number | undefined {
  try {
    const value = now();
    if (Number.isFinite(value)) return value;
  } catch {
    // Failure is reported below without exception details.
  }
  safelyLogObservabilityFailure(logger, correlationId, 'request.log');
  return undefined;
}

/** Calculates a finite bounded duration or zero when timing is unavailable. */
function elapsedSeconds(
  startedAt: number | undefined,
  finishedAt: number | undefined,
): number {
  if (startedAt === undefined || finishedAt === undefined) return 0;
  return Math.min(
    MAX_DURATION_SECONDS,
    Math.max(0, (finishedAt - startedAt) / 1000),
  );
}

/**
 * Creates gateway middleware that emits bounded metrics, fixed-schema logs,
 * and an async-safe correlation context. Observability failures are isolated.
 */
export function createGatewayObservabilityMiddleware(
  metrics: PrometheusHttpMetrics = gatewayMetrics,
  correlationIdFactory?: CorrelationIdFactory,
  logger: CredentialFreeJsonLogger = gatewayLogger,
  now: MonotonicClock = () => performance.now(),
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

    const method = request.method;
    const route = routeTemplate(request.path);
    const startedAt = safelyReadClock(now, logger, correlationId);
    let finishMetric: (statusCode: number) => boolean = () => false;
    try {
      finishMetric = metrics.beginHttpRequest({ method, route });
    } catch {
      safelyLogObservabilityFailure(logger, correlationId, 'metrics.record');
    }

    let completed = false;
    const recordCompletion = (statusCode: number): void => {
      if (completed) return;
      completed = true;
      const durationSeconds = elapsedSeconds(
        startedAt,
        safelyReadClock(now, logger, correlationId),
      );

      try {
        finishMetric(statusCode);
      } catch {
        safelyLogObservabilityFailure(logger, correlationId, 'metrics.record');
      }

      try {
        logger.httpRequestCompleted({
          correlationId,
          method,
          route,
          statusCode,
          durationSeconds,
        });
      } catch {
        safelyLogObservabilityFailure(logger, correlationId, 'request.log');
      }
    };

    response.once('finish', () => {
      recordCompletion(response.statusCode);
    });
    response.once('close', () => {
      recordCompletion(CLIENT_CLOSED_REQUEST_STATUS);
    });

    let callbackStarted = false;
    try {
      runWithRequestContext(correlationId, () => {
        callbackStarted = true;
        next();
      });
    } catch (error) {
      if (!callbackStarted) {
        safelyLogObservabilityFailure(logger, correlationId, 'request.context');
        next();
        return;
      }
      recordCompletion(500);
      throw error;
    }
  };
}

/** Default gateway observability middleware instance. */
export const gatewayObservabilityMiddleware =
  createGatewayObservabilityMiddleware();
