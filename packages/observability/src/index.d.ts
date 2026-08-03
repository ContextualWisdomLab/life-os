export declare const PROMETHEUS_CONTENT_TYPE: string;
export declare const DEFAULT_DURATION_BUCKETS: readonly number[];

export interface PrometheusHttpMetricsOptions {
  serviceName: string;
  durationBuckets?: readonly number[];
  maxSeries?: number;
  now?: () => number;
}

export interface HttpRequestLabels {
  method: string;
  route: string;
}

export interface HttpRequestObservation extends HttpRequestLabels {
  statusCode: number;
  durationSeconds: number;
}

export declare class PrometheusHttpMetrics {
  constructor(options: PrometheusHttpMetricsOptions);
  beginHttpRequest(labels: HttpRequestLabels): (statusCode: number) => boolean;
  observeHttpRequest(observation: HttpRequestObservation): void;
  renderPrometheus(): string;
}

export declare function normalizeCorrelationId(
  value: unknown,
  generate?: () => string,
): string;
