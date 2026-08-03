'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;
const ROUTE_PARAMETER_PATTERN = /^:[a-z][a-z0-9_]{1,63}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ALLOWED_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);
const OBSERVABILITY_OPERATIONS = new Set([
  'metrics.record',
  'request.context',
  'request.log',
]);
const DEFAULT_DURATION_BUCKETS = Object.freeze([0.05, 0.1, 0.25, 0.5, 1, 2, 5]);
const MAX_DURATION_SECONDS = 3600;

/** @typedef {{readonly correlationId: string}} RequestContext */
/** @type {AsyncLocalStorage<RequestContext>} */
const requestContextStorage = new AsyncLocalStorage();

/** Validates and returns a bounded telemetry service identifier. */
function requireServiceName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !SERVICE_NAME_PATTERN.test(value)
  ) {
    throw new TypeError(
      'serviceName must be a bounded lowercase hyphenated identifier',
    );
  }
  return value;
}

/** Normalizes an allowed HTTP method for metric and log fields. */
function requireMethod(value) {
  if (typeof value !== 'string') {
    throw new TypeError('method must be a supported HTTP method');
  }
  const normalized = value.toUpperCase();
  if (!ALLOWED_METHODS.has(normalized)) {
    throw new TypeError('method must be a supported HTTP method');
  }
  return normalized;
}

/** Validates that a route is a bounded template without concrete identifiers. */
function requireRouteTemplate(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 160 ||
    !value.startsWith('/') ||
    value.includes('?') ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  ) {
    throw new TypeError('route must be a bounded path template');
  }

  const segments = value.split('/').slice(1);
  for (const segment of segments) {
    if (!segment) continue;
    if (/^[0-9]+$/.test(segment) || UUID_PATTERN.test(segment)) {
      throw new TypeError('route must not contain a concrete identifier');
    }
    if (segment.startsWith(':')) {
      if (!ROUTE_PARAMETER_PATTERN.test(segment)) {
        throw new TypeError('route contains an invalid parameter template');
      }
      continue;
    }
    if (!ROUTE_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError('route contains an invalid path segment');
    }
  }
  return value;
}

/** Validates a status code before deriving its bounded status class. */
function requireStatusCode(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw new TypeError('statusCode must be an HTTP status code');
  }
  return value;
}

/** Validates a finite bounded request duration in seconds. */
function requireDuration(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_DURATION_SECONDS
  ) {
    throw new TypeError('durationSeconds must be finite and bounded');
  }
  return value;
}

/** Validates strictly increasing histogram boundaries. */
function requireBuckets(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new TypeError('durationBuckets must contain 1 to 20 values');
  }
  let prior = 0;
  return Object.freeze(
    value.map((bucket) => {
      if (
        typeof bucket !== 'number' ||
        !Number.isFinite(bucket) ||
        bucket <= prior ||
        bucket > MAX_DURATION_SECONDS
      ) {
        throw new TypeError(
          'durationBuckets must be strictly increasing positive values',
        );
      }
      prior = bucket;
      return bucket;
    }),
  );
}

/** Validates the maximum number of in-memory metric series. */
function requireSeriesLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw new TypeError('maxSeries must be an integer from 1 to 4096');
  }
  return value;
}

/** Validates the monotonic clock dependency used by request timers. */
function requireClock(value) {
  if (typeof value !== 'function') {
    throw new TypeError('now must be a function');
  }
  return value;
}

/** Validates the wall-clock dependency used by structured logs. */
function requireWallClock(value) {
  if (typeof value !== 'function') {
    throw new TypeError('wallClock must be a function');
  }
  return value;
}

/** Validates the structured-log writer dependency. */
function requireWriter(value) {
  if (typeof value !== 'function') {
    throw new TypeError('write must be a function');
  }
  return value;
}

/** Validates one normalized UUIDv4 correlation identifier. */
function requireCorrelationId(value) {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new TypeError('correlationId must be a UUIDv4');
  }
  return value.toLowerCase();
}

/** Validates a canonical UTC timestamp before it enters a log record. */
function requireTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError('wallClock must return an ISO UTC timestamp');
  }
  return value;
}

/** Validates the fixed operation vocabulary for failure records. */
function requireObservabilityOperation(value) {
  if (typeof value !== 'string' || !OBSERVABILITY_OPERATIONS.has(value)) {
    throw new TypeError(
      'operation must be a supported observability operation',
    );
  }
  return value;
}

/** Validates a callback before entering async request context. */
function requireCallback(value) {
  if (typeof value !== 'function') {
    throw new TypeError('callback must be a function');
  }
  return value;
}

/** Escapes a bounded label value for Prometheus text exposition. */
function escapeLabel(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

/** Renders a stable Prometheus label set. */
function labels(values) {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(',')}}`;
}

/** Renders finite metric values without avoidable floating-point noise. */
function metricNumber(value) {
  if (Number.isSafeInteger(value)) return String(value);
  return String(Number(value.toFixed(9)));
}

/** Returns a JSON-safe finite duration without avoidable floating-point noise. */
function logDuration(value) {
  return Number(value.toFixed(9));
}

/** Maps an HTTP status code to a bounded class such as 2xx. */
function statusClass(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

/** Maps an HTTP status code to a bounded structured-log level. */
function statusLevel(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/** Creates a collision-safe internal key for one metric series. */
function keyOf(method, route, responseClass) {
  return JSON.stringify([method, route, responseClass]);
}

/** Restores metric labels from an internal series key. */
function parseKey(key) {
  const [method, route, responseClass] = JSON.parse(key);
  return { method, route, status_class: responseClass };
}

/** Writes one line to standard output without inspecting request data. */
function defaultStructuredLogWriter(line) {
  process.stdout.write(`${line}\n`);
}

/** Preserves a valid UUIDv4 correlation ID or creates a replacement. */
function normalizeCorrelationId(value, generate = randomUUID) {
  if (typeof value === 'string' && UUID_V4_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  if (typeof generate !== 'function') {
    throw new TypeError('correlation ID generator must be a function');
  }
  const generated = generate();
  if (typeof generated !== 'string' || !UUID_V4_PATTERN.test(generated)) {
    throw new TypeError('correlation ID generator must return a UUIDv4');
  }
  return generated.toLowerCase();
}

/**
 * Runs a callback inside an async-safe request context containing only a
 * validated correlation identifier. Nested contexts restore automatically.
 */
function runWithRequestContext(correlationId, callback) {
  const context = Object.freeze({
    correlationId: requireCorrelationId(correlationId),
  });
  return requestContextStorage.run(context, requireCallback(callback));
}

/** Returns the current immutable request context, when one is active. */
function getRequestContext() {
  return requestContextStorage.getStore();
}

/**
 * Emits credential-free JSON records from a fixed schema. Arbitrary request
 * fields and exception details are not accepted by this interface.
 */
class CredentialFreeJsonLogger {
  /** Creates a structured logger with injectable deterministic boundaries. */
  constructor({
    serviceName,
    write = defaultStructuredLogWriter,
    wallClock = () => new Date().toISOString(),
  }) {
    this.serviceName = requireServiceName(serviceName);
    this.write = requireWriter(write);
    this.wallClock = requireWallClock(wallClock);
  }

  /** Emits one bounded HTTP completion record and returns its serialized line. */
  httpRequestCompleted({
    correlationId,
    method,
    route,
    statusCode,
    durationSeconds,
  }) {
    const normalizedStatusCode = requireStatusCode(statusCode);
    const record = {
      timestamp: requireTimestamp(this.wallClock()),
      level: statusLevel(normalizedStatusCode),
      event: 'http.request.completed',
      service: this.serviceName,
      correlation_id: requireCorrelationId(correlationId),
      method: requireMethod(method),
      route: requireRouteTemplate(route),
      status_code: normalizedStatusCode,
      status_class: statusClass(normalizedStatusCode),
      duration_seconds: logDuration(requireDuration(durationSeconds)),
    };
    const line = JSON.stringify(record);
    this.write(line);
    return line;
  }

  /** Emits a sanitized observability failure without exception details. */
  observabilityFailure({ correlationId, operation }) {
    const record = {
      timestamp: requireTimestamp(this.wallClock()),
      level: 'error',
      event: 'observability.failure',
      service: this.serviceName,
      correlation_id: requireCorrelationId(correlationId),
      operation: requireObservabilityOperation(operation),
    };
    const line = JSON.stringify(record);
    this.write(line);
    return line;
  }
}

/**
 * Stores bounded HTTP counters, histograms, and an in-flight gauge in memory.
 * The registry has no ambient state and renders Prometheus text on demand.
 */
class PrometheusHttpMetrics {
  /** Creates a metrics registry with validated cardinality and time bounds. */
  constructor({
    serviceName,
    durationBuckets = DEFAULT_DURATION_BUCKETS,
    maxSeries = 256,
    now = () => performance.now(),
  }) {
    this.serviceName = requireServiceName(serviceName);
    this.durationBuckets = requireBuckets(durationBuckets);
    this.maxSeries = requireSeriesLimit(maxSeries);
    this.now = requireClock(now);
    this.series = new Map();
    this.inFlight = 0;
  }

  /** Starts a request timer and returns an idempotent completion callback. */
  beginHttpRequest({ method, route }) {
    const normalizedMethod = requireMethod(method);
    const normalizedRoute = requireRouteTemplate(route);
    const startedAt = this.now();
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
      throw new TypeError('now must return a finite millisecond timestamp');
    }
    this.inFlight += 1;
    let completed = false;

    return (statusCode) => {
      if (completed) return false;
      completed = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      const finishedAt = this.now();
      if (typeof finishedAt !== 'number' || !Number.isFinite(finishedAt)) {
        throw new TypeError('now must return a finite millisecond timestamp');
      }
      const durationSeconds = Math.min(
        MAX_DURATION_SECONDS,
        Math.max(0, (finishedAt - startedAt) / 1000),
      );
      this.observeHttpRequest({
        method: normalizedMethod,
        route: normalizedRoute,
        statusCode,
        durationSeconds,
      });
      return true;
    };
  }

  /** Records one validated completed request observation. */
  observeHttpRequest({ method, route, statusCode, durationSeconds }) {
    const normalizedMethod = requireMethod(method);
    const normalizedRoute = requireRouteTemplate(route);
    const normalizedStatusCode = requireStatusCode(statusCode);
    const normalizedDuration = requireDuration(durationSeconds);
    const responseClass = statusClass(normalizedStatusCode);
    const key = keyOf(normalizedMethod, normalizedRoute, responseClass);
    let entry = this.series.get(key);

    if (!entry) {
      if (this.series.size >= this.maxSeries) {
        throw new RangeError('observability series limit exceeded');
      }
      entry = {
        count: 0,
        sum: 0,
        buckets: this.durationBuckets.map(() => 0),
      };
      this.series.set(key, entry);
    }

    entry.count += 1;
    entry.sum += normalizedDuration;
    for (let index = 0; index < this.durationBuckets.length; index += 1) {
      if (normalizedDuration <= this.durationBuckets[index]) {
        entry.buckets[index] += 1;
      }
    }
  }

  /** Renders the complete registry in Prometheus text exposition format. */
  renderPrometheus() {
    const output = [
      '# HELP life_os_http_requests_total Completed HTTP requests.',
      '# TYPE life_os_http_requests_total counter',
    ];
    const sortedEntries = [...this.series.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );

    for (const [key, entry] of sortedEntries) {
      const parsed = parseKey(key);
      output.push(
        `life_os_http_requests_total${labels({ service: this.serviceName, ...parsed })} ${entry.count}`,
      );
    }

    output.push(
      '# HELP life_os_http_request_duration_seconds HTTP request duration in seconds.',
      '# TYPE life_os_http_request_duration_seconds histogram',
    );
    for (const [key, entry] of sortedEntries) {
      const parsed = parseKey(key);
      for (let index = 0; index < this.durationBuckets.length; index += 1) {
        output.push(
          `life_os_http_request_duration_seconds_bucket${labels({ service: this.serviceName, ...parsed, le: metricNumber(this.durationBuckets[index]) })} ${entry.buckets[index]}`,
        );
      }
      output.push(
        `life_os_http_request_duration_seconds_bucket${labels({ service: this.serviceName, ...parsed, le: '+Inf' })} ${entry.count}`,
      );
      output.push(
        `life_os_http_request_duration_seconds_sum${labels({ service: this.serviceName, ...parsed })} ${metricNumber(entry.sum)}`,
      );
      output.push(
        `life_os_http_request_duration_seconds_count${labels({ service: this.serviceName, ...parsed })} ${entry.count}`,
      );
    }

    output.push(
      '# HELP life_os_http_in_flight_requests HTTP requests currently being processed.',
      '# TYPE life_os_http_in_flight_requests gauge',
      `life_os_http_in_flight_requests${labels({ service: this.serviceName })} ${this.inFlight}`,
      '',
    );
    return output.join('\n');
  }
}

module.exports = {
  CredentialFreeJsonLogger,
  DEFAULT_DURATION_BUCKETS,
  PROMETHEUS_CONTENT_TYPE,
  PrometheusHttpMetrics,
  getRequestContext,
  normalizeCorrelationId,
  runWithRequestContext,
};
