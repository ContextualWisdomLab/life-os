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
  once(event: 'finish', listener: () => void): void;
}

type GatewayNext = () => void;
type CorrelationIdFactory = () => string;

const BOUNDED_ROUTE_TEMPLATES = new Set([
  '/v1/health',
  '/v1/metrics',
  '/v1/today',
]);

export const gatewayMetrics = new PrometheusHttpMetrics({
  serviceName: 'life-os-gateway',
});

function routeTemplate(path: string): string {
  return BOUNDED_ROUTE_TEMPLATES.has(path) ? path : '/unmatched';
}

function correlationHeader(
  headers: GatewayRequest['headers'],
): string | undefined {
  const value = headers['x-correlation-id'];
  return typeof value === 'string' ? value : undefined;
}

export function createGatewayObservabilityMiddleware(
  metrics: PrometheusHttpMetrics = gatewayMetrics,
  correlationIdFactory?: CorrelationIdFactory,
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
    response.once('finish', () => {
      finish(response.statusCode);
    });

    try {
      next();
    } catch (error) {
      finish(500);
      throw error;
    }
  };
}

export const gatewayObservabilityMiddleware =
  createGatewayObservabilityMiddleware();
