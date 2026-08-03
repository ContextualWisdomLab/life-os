'use strict';

const { randomUUID } = require('node:crypto');

const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;
const ROUTE_PARAMETER_PATTERN = /^:[a-z][a-z0-9_]{1,63}$/;
const ALLOWED_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);
const DEFAULT_DURATION_BUCKETS = Object.freeze([
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2,
  5,
]);
const MAX_DURATION_SECONDS = 3600;

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

function requireStatusCode(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw new TypeError('statusCode must be an HTTP status code');
  }
  return value;
}

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

function requireSeriesLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw new TypeError('maxSeries must be an integer from 1 to 4096');
  }
  return value;
}

function requireClock(value) {
  if (typeof value !== 'function') {
    throw new TypeError('now must be a function');
  }
  return value;
}

function escapeLabel(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

function labels(values) {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(',')}}`;
}

function metricNumber(value) {
  if (Number.isSafeInteger(value)) return String(value);
  return String(Number(value.toFixed(9)));
}

function statusClass(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function keyOf(method, route, responseClass) {
  return JSON.stringify([method, route, responseClass]);
}

function parseKey(key) {
  const [method, route, responseClass] = JSON.parse(key);
  return { method, route, status_class: responseClass };
}

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

class PrometheusHttpMetrics {
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
  DEFAULT_DURATION_BUCKETS,
  PROMETHEUS_CONTENT_TYPE,
  PrometheusHttpMetrics,
  normalizeCorrelationId,
};
