'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROMETHEUS_CONTENT_TYPE,
  PrometheusHttpMetrics,
  normalizeCorrelationId,
} = require('./index.cjs');

const FIRST_UUID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const SECOND_UUID = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';

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
