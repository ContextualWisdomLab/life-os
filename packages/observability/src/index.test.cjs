'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CredentialFreeJsonLogger,
  PROMETHEUS_CONTENT_TYPE,
  PrometheusHttpMetrics,
  getRequestContext,
  normalizeCorrelationId,
  runWithRequestContext,
} = require('./index.cjs');

const FIRST_UUID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const SECOND_UUID = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const FIXED_TIMESTAMP = '2026-08-03T19:30:00.000Z';

test('preserves valid UUIDv4 correlation IDs and replaces invalid input', () => {
  assert.equal(normalizeCorrelationId(FIRST_UUID.toUpperCase()), FIRST_UUID);
  assert.equal(
    normalizeCorrelationId('session=secret', () => SECOND_UUID),
    SECOND_UUID,
  );
  assert.throws(
    () => normalizeCorrelationId(undefined, () => 'not-a-uuid'),
    /must return a UUIDv4/,
  );
});

test('propagates immutable request context across async boundaries', async () => {
  assert.equal(getRequestContext(), undefined);

  const correlationId = await runWithRequestContext(
    FIRST_UUID.toUpperCase(),
    async () => {
      await Promise.resolve();
      const context = getRequestContext();
      assert.deepEqual(context, { correlationId: FIRST_UUID });
      assert.equal(Object.isFrozen(context), true);
      return context?.correlationId;
    },
  );

  assert.equal(correlationId, FIRST_UUID);
  assert.equal(getRequestContext(), undefined);
});

test('restores an outer request context after a nested context', () => {
  runWithRequestContext(FIRST_UUID, () => {
    assert.equal(getRequestContext()?.correlationId, FIRST_UUID);
    runWithRequestContext(SECOND_UUID, () => {
      assert.equal(getRequestContext()?.correlationId, SECOND_UUID);
    });
    assert.equal(getRequestContext()?.correlationId, FIRST_UUID);
  });
  assert.equal(getRequestContext(), undefined);
});

test('rejects invalid request context inputs', () => {
  assert.throws(
    () => runWithRequestContext('session=secret', () => undefined),
    /correlationId must be a UUIDv4/,
  );
  assert.throws(
    () => runWithRequestContext(FIRST_UUID, /** @type {never} */ (null)),
    /callback must be a function/,
  );
});

test('emits a deterministic credential-free HTTP completion record', () => {
  const lines = [];
  const logger = new CredentialFreeJsonLogger({
    serviceName: 'life-os-gateway',
    write: (line) => lines.push(line),
    wallClock: () => FIXED_TIMESTAMP,
  });

  const line = logger.httpRequestCompleted({
    correlationId: FIRST_UUID,
    method: 'get',
    route: '/v1/today',
    statusCode: 503,
    durationSeconds: 0.1250000001,
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0], line);
  assert.deepEqual(JSON.parse(line), {
    timestamp: FIXED_TIMESTAMP,
    level: 'error',
    event: 'http.request.completed',
    service: 'life-os-gateway',
    correlation_id: FIRST_UUID,
    method: 'GET',
    route: '/v1/today',
    status_code: 503,
    status_class: '5xx',
    duration_seconds: 0.125,
  });
  assert.doesNotMatch(line, /authorization|cookie|session|secret|stack/i);
});

test('uses bounded levels and rejects concrete structured-log dimensions', () => {
  const lines = [];
  const logger = new CredentialFreeJsonLogger({
    serviceName: 'life-os-gateway',
    write: (line) => lines.push(line),
    wallClock: () => FIXED_TIMESTAMP,
  });

  for (const [statusCode, level] of [
    [200, 'info'],
    [404, 'warn'],
    [500, 'error'],
  ]) {
    const record = JSON.parse(
      logger.httpRequestCompleted({
        correlationId: FIRST_UUID,
        method: 'GET',
        route: '/v1/health',
        statusCode,
        durationSeconds: 0,
      }),
    );
    assert.equal(record.level, level);
  }

  assert.equal(lines.length, 3);
  assert.throws(
    () =>
      logger.httpRequestCompleted({
        correlationId: FIRST_UUID,
        method: 'GET',
        route: `/v1/tasks/${SECOND_UUID}`,
        statusCode: 200,
        durationSeconds: 0.1,
      }),
    /concrete identifier/,
  );
  assert.throws(
    () =>
      logger.httpRequestCompleted({
        correlationId: FIRST_UUID,
        method: 'TRACE',
        route: '/v1/health',
        statusCode: 200,
        durationSeconds: 0.1,
      }),
    /supported HTTP method/,
  );
});

test('emits sanitized observability failures without exception details', () => {
  const lines = [];
  const logger = new CredentialFreeJsonLogger({
    serviceName: 'life-os-gateway',
    write: (line) => lines.push(line),
    wallClock: () => FIXED_TIMESTAMP,
  });

  const line = logger.observabilityFailure({
    correlationId: FIRST_UUID,
    operation: 'metrics.record',
  });

  assert.deepEqual(JSON.parse(line), {
    timestamp: FIXED_TIMESTAMP,
    level: 'error',
    event: 'observability.failure',
    service: 'life-os-gateway',
    correlation_id: FIRST_UUID,
    operation: 'metrics.record',
  });
  assert.doesNotMatch(line, /message|stack|secret|header|path/i);
  assert.equal(lines.length, 1);
  assert.throws(
    () =>
      logger.observabilityFailure({
        correlationId: FIRST_UUID,
        operation: 'database.password',
      }),
    /supported observability operation/,
  );
});

test('surfaces writer failures for callers to isolate', () => {
  const logger = new CredentialFreeJsonLogger({
    serviceName: 'life-os-gateway',
    write: () => {
      throw new Error('writer unavailable');
    },
    wallClock: () => FIXED_TIMESTAMP,
  });

  assert.throws(
    () =>
      logger.httpRequestCompleted({
        correlationId: FIRST_UUID,
        method: 'GET',
        route: '/v1/health',
        statusCode: 200,
        durationSeconds: 0.1,
      }),
    /writer unavailable/,
  );
});

test('records one bounded series and ignores duplicate request completion', () => {
  const clock = [1000, 1250];
  const metrics = new PrometheusHttpMetrics({
    serviceName: 'life-os-gateway',
    now: () => clock.shift(),
  });
  const finish = metrics.beginHttpRequest({
    method: 'get',
    route: '/v1/today',
  });

  assert.equal(finish(503), true);
  assert.equal(finish(200), false);

  const output = metrics.renderPrometheus();
  assert.match(
    output,
    /life_os_http_requests_total\{service="life-os-gateway",method="GET",route="\/v1\/today",status_class="5xx"\} 1/,
  );
  assert.match(
    output,
    /life_os_http_request_duration_seconds_bucket\{service="life-os-gateway",method="GET",route="\/v1\/today",status_class="5xx",le="0.25"\} 1/,
  );
  assert.match(
    output,
    /life_os_http_request_duration_seconds_sum\{service="life-os-gateway",method="GET",route="\/v1\/today",status_class="5xx"\} 0.25/,
  );
  assert.match(
    output,
    /life_os_http_in_flight_requests\{service="life-os-gateway"\} 0/,
  );
  assert.equal(output.endsWith('\n'), true);
  assert.equal(
    PROMETHEUS_CONTENT_TYPE,
    'text/plain; version=0.0.4; charset=utf-8',
  );
});

test('tracks in-flight requests without exposing correlation identifiers', () => {
  const metrics = new PrometheusHttpMetrics({
    serviceName: 'life-os-gateway',
    now: () => 1000,
  });
  metrics.beginHttpRequest({ method: 'GET', route: '/v1/health' });

  const output = metrics.renderPrometheus();
  assert.match(
    output,
    /life_os_http_in_flight_requests\{service="life-os-gateway"\} 1/,
  );
  assert.doesNotMatch(output, /correlation|018f47b2/i);
});

test('rejects concrete and unbounded telemetry dimensions', () => {
  const metrics = new PrometheusHttpMetrics({
    serviceName: 'life-os-gateway',
    maxSeries: 1,
    now: () => 1000,
  });

  for (const route of [
    '/v1/tasks/123',
    `/v1/tasks/${FIRST_UUID}`,
    '/v1/tasks?workspace=secret',
    '/v1/:BadParameter',
  ]) {
    assert.throws(
      () =>
        metrics.observeHttpRequest({
          method: 'GET',
          route,
          statusCode: 200,
          durationSeconds: 0.1,
        }),
      /route/,
    );
  }

  metrics.observeHttpRequest({
    method: 'GET',
    route: '/v1/tasks/:task_id',
    statusCode: 200,
    durationSeconds: 0.1,
  });
  assert.throws(
    () =>
      metrics.observeHttpRequest({
        method: 'POST',
        route: '/v1/tasks/:task_id',
        statusCode: 201,
        durationSeconds: 0.1,
      }),
    /series limit/,
  );
});
