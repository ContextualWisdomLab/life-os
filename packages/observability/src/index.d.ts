/** Prometheus text exposition content type used by the metrics endpoint. */
export declare const PROMETHEUS_CONTENT_TYPE: string;

/** Default bounded request-duration histogram boundaries in seconds. */
export declare const DEFAULT_DURATION_BUCKETS: readonly number[];

/** Immutable request-scoped observability context. */
export interface RequestContext {
  /** Validated lowercase UUIDv4 correlation identifier. */
  readonly correlationId: string;
}

/** Runs a callback inside an async-safe request context. */
export declare function runWithRequestContext<T>(
  correlationId: string,
  callback: () => T,
): T;

/** Returns the current request context when one is active. */
export declare function getRequestContext(): RequestContext | undefined;

/** Fixed sanitized operation vocabulary for observability failures. */
export type ObservabilityOperation =
  'metrics.record' | 'request.context' | 'request.log';

/** Construction options for the credential-free structured logger. */
export interface CredentialFreeJsonLoggerOptions {
  /** Lowercase hyphenated service identifier included in every record. */
  serviceName: string;
  /** Receives one serialized JSON line without a trailing newline. */
  write?: (line: string) => void;
  /** Returns a canonical ISO UTC timestamp. */
  wallClock?: () => string;
}

/** Bounded fields accepted by an HTTP completion record. */
export interface HttpRequestCompletionLog {
  /** Validated UUIDv4 correlation identifier. */
  correlationId: string;
  /** Supported HTTP method. */
  method: string;
  /** Low-cardinality route template without concrete identifiers. */
  route: string;
  /** HTTP or synthetic status code from 100 through 599. */
  statusCode: number;
  /** Finite request duration in seconds. */
  durationSeconds: number;
}

/** Sanitized fields accepted by an observability failure record. */
export interface ObservabilityFailureLog {
  /** Validated UUIDv4 correlation identifier. */
  correlationId: string;
  /** Fixed operation that failed. */
  operation: ObservabilityOperation;
}

/** Emits fixed-schema credential-free JSON records. */
export declare class CredentialFreeJsonLogger {
  /** Creates a logger with injectable deterministic boundaries. */
  constructor(options: CredentialFreeJsonLoggerOptions);

  /** Emits one bounded HTTP completion record. */
  httpRequestCompleted(record: HttpRequestCompletionLog): string;

  /** Emits one sanitized observability failure record. */
  observabilityFailure(record: ObservabilityFailureLog): string;
}

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
