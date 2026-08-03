/** Prometheus text exposition content type used by the metrics endpoint. */
export declare const PROMETHEUS_CONTENT_TYPE: string;

/** Default bounded request-duration histogram boundaries in seconds. */
export declare const DEFAULT_DURATION_BUCKETS: readonly number[];

/** Construction options for an isolated HTTP metrics registry. */
export interface PrometheusHttpMetricsOptions {
  /** Lowercase hyphenated service identifier included in every series. */
  serviceName: string;
  /** Strictly increasing bounded histogram boundaries in seconds. */
  durationBuckets?: readonly number[];
  /** Maximum distinct method, route, and status-class series. */
  maxSeries?: number;
  /** Monotonic clock returning milliseconds. */
  now?: () => number;
}

/** Bounded labels used when starting an HTTP request observation. */
export interface HttpRequestLabels {
  /** Supported HTTP method. */
  method: string;
  /** Low-cardinality route template without concrete identifiers. */
  route: string;
}

/** Completed HTTP request values recorded by the registry. */
export interface HttpRequestObservation extends HttpRequestLabels {
  /** HTTP or synthetic status code from 100 through 599. */
  statusCode: number;
  /** Finite request duration in seconds. */
  durationSeconds: number;
}

/** Stores bounded HTTP counters, histograms, and in-flight requests in memory. */
export declare class PrometheusHttpMetrics {
  /** Creates a validated isolated metrics registry. */
  constructor(options: PrometheusHttpMetricsOptions);

  /** Starts a request and returns an idempotent completion callback. */
  beginHttpRequest(labels: HttpRequestLabels): (statusCode: number) => boolean;

  /** Records one validated completed request observation. */
  observeHttpRequest(observation: HttpRequestObservation): void;

  /** Renders the complete registry in Prometheus text exposition format. */
  renderPrometheus(): string;
}

/** Preserves a valid UUIDv4 correlation ID or generates a replacement. */
export declare function normalizeCorrelationId(
  value: unknown,
  generate?: () => string,
): string;
