# LifeOS planning-service service-level objectives

## Scope and status

This specification governs completed HTTP requests handled by the planning service. It covers goal, project, and task operations; it does not claim end-to-end reliability for the gateway, browser, identity, habit, review, AI, calendar, or notification workflows.

The source of truth is the Prometheus exposition at `GET /v1/metrics`, scraped by the `life-os-planning-service` job in `infra/observability/prometheus.yml`. Health and metrics requests are operational probes and are excluded from user-facing service-level indicators.

## Telemetry trust boundary

- Metrics use only the fixed service name, a bounded HTTP method, a fixed route template, and the response status class.
- Workspace identifiers, goal identifiers, project identifiers, task identifiers, cookies, authorization values, request bodies, query strings, and correlation identifiers are forbidden as metric labels.
- Concrete goal and project paths map to `/v1/goals/:goal_id/projects` and `/v1/projects/:project_id/tasks`; unknown paths collapse to `/unmatched`.
- `x-correlation-id` is an opaque UUIDv4 returned for operational correlation. It is not authentication or authorization evidence.
- Production ingress must deny public access to `/v1/metrics` and permit only the monitoring network.
- Monitoring retention, alert delivery, and remote storage must not introduce tenant data or credentials.

## Availability objective

**Objective:** at least **99.9%** of completed user-facing planning requests succeed over a rolling 30-day window.

A request is good when its response status class is not `5xx`. Client errors remain in the denominator and are treated as available because the service produced a bounded response. Responses closed before normal completion are finalized as synthetic status `499` so they cannot leak the in-flight gauge.

```promql
1 - (
  sum(rate(life_os_http_requests_total{
    service="life-os-planning-service",
    route!~"/v1/(health|metrics)",
    status_class="5xx"
  }[30d]))
  /
  clamp_min(sum(rate(life_os_http_requests_total{
    service="life-os-planning-service",
    route!~"/v1/(health|metrics)"
  }[30d])), 0.000001)
)
```

The request error budget is **0.1%**, or one server-failed request per 1,000 completed user-facing requests.

## Latency objectives

For completed user-facing planning requests over a rolling 30-day window:

- at least **95%** complete within **500 ms**;
- at least **99%** complete within **2 seconds**.

The histogram includes planning-service processing and synchronous PostgreSQL work completed before the response finishes.

```promql
sum(rate(life_os_http_request_duration_seconds_bucket{
  service="life-os-planning-service",
  route!~"/v1/(health|metrics)",
  le="0.5"
}[30d]))
/
clamp_min(sum(rate(life_os_http_request_duration_seconds_count{
  service="life-os-planning-service",
  route!~"/v1/(health|metrics)"
}[30d])), 0.000001)
```

```promql
sum(rate(life_os_http_request_duration_seconds_bucket{
  service="life-os-planning-service",
  route!~"/v1/(health|metrics)",
  le="2"
}[30d]))
/
clamp_min(sum(rate(life_os_http_request_duration_seconds_count{
  service="life-os-planning-service",
  route!~"/v1/(health|metrics)"
}[30d])), 0.000001)
```

## Alert policy

`infra/observability/planning-alerts.yml` provides the initial operational gates.

- `LifeOsPlanningServiceTargetDown` pages when the target is down or absent for five minutes.
- `LifeOsPlanningServiceAvailabilityFastBurn` pages when both the five-minute and one-hour server-error ratios exceed the 14.4x threshold.
- `LifeOsPlanningServiceAvailabilitySlowBurn` opens an operational incident when both the 30-minute and six-hour server-error ratios exceed the 6x threshold.
- `LifeOsPlanningServiceLatencyBudgetBurn` opens an incident when more than 30% of requests exceed 500 ms for 15 minutes.
- `LifeOsPlanningServiceTailLatencyBudgetBurn` opens an incident when more than 1% of requests exceed 2 seconds for 15 minutes.

## Incident and error-budget policy

1. Confirm the alert from raw Prometheus data and determine whether the target or service is failing.
2. Capture the response `x-correlation-id`, affected route template, release identifier, and time range. This slice does not yet emit correlated application logs or propagate context downstream.
3. Mitigate user impact through rollback, traffic reduction, or database dependency isolation before undertaking deeper diagnosis.
4. Record detection, mitigation, recovery, affected operations, and consumed error budget without copying tenant payloads into incident systems.
5. Freeze reliability-risking feature releases when the rolling availability budget is exhausted until the responsible failure mode is corrected and verified.
6. SLO targets may change only through reviewed source control and may not be weakened retroactively to hide a miss.

## Deployment requirements

- Replace the reference static target `planning-service:4102` with production service discovery while preserving the job and service label contracts.
- Load `planning-alerts.yml` from the same trusted Prometheus configuration bundle as the scrape configuration.
- Validate the configuration and rules with `promtool check config` and `promtool check rules` in the production-image build or deployment pipeline.
- Retain enough history to evaluate rolling 30-day objectives and protect monitoring storage with production operational controls.

## Deferred coverage

Structured log correlation, trace propagation, OpenTelemetry spans, database saturation metrics, synthetic planning journeys, dashboards, alert delivery, release annotations, and long-term metrics storage remain follow-up slices tracked by issue #64.
