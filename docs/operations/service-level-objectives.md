# LifeOS gateway service-level objectives

## Scope and status

This specification governs the user-facing LifeOS gateway. The gateway now exposes bounded metrics, async-safe correlation context, and credential-free structured completion records. It does not claim coverage for identity, planning, habit, review, AI, calendar, notification, or browser-only workflows. Those services must adopt the shared telemetry boundary before their reliability can be included in a product-wide objective.

The source of truth is the Prometheus exposition at `GET /v1/metrics`, scraped by `infra/observability/prometheus.yml`. Health and metrics requests are operational probes and are excluded from user-facing service-level indicators.

## Telemetry trust boundary

- Metrics use only the fixed service name, a bounded HTTP method, a route template, and the response status class.
- Concrete UUIDs, numeric identifiers, query strings, workspace identifiers, actor identifiers, cookies, authorization values, session values, and correlation identifiers are forbidden as metric labels.
- Unknown gateway paths collapse to `/unmatched`; they never become a new label value.
- `x-correlation-id` is an opaque UUIDv4 used for request correlation. It is not authentication or authorization evidence.
- The request context contains only the validated correlation identifier and propagates through asynchronous work initiated by the gateway request.
- Each completed, failed, or client-aborted request emits one JSON record containing only timestamp, level, event, service, correlation identifier, bounded method, bounded route template, status code, status class, and bounded duration.
- Observability failures emit only timestamp, level, event, service, correlation identifier, and a fixed operation name. Exception messages, stacks, request headers, query strings, concrete paths, tenant data, and credentials are not serialized.
- The metrics endpoint contains operational data and must be reachable only from the monitoring network in production. Public ingress must deny `/v1/metrics`.
- Metric and log retention, remote storage, and alert delivery must not introduce tenant data or credentials.

## Availability objective

**Objective:** at least **99.9%** of completed user-facing gateway requests succeed over a rolling 30-day window.

A request is good when its response status class is not `5xx`. A request is total when it reaches the gateway and completes on a route other than `/v1/health` or `/v1/metrics`. Client failures (`4xx`) remain in the denominator and are treated as available because the gateway produced a bounded response; separate product telemetry must detect unusable client flows. Responses closed before normal completion are finalized as synthetic status `499` so they cannot leak the in-flight gauge.

```promql
1 - (
  sum(rate(life_os_http_requests_total{
    service="life-os-gateway",
    route!~"/v1/(health|metrics)",
    status_class="5xx"
  }[30d]))
  /
  clamp_min(sum(rate(life_os_http_requests_total{
    service="life-os-gateway",
    route!~"/v1/(health|metrics)"
  }[30d])), 0.000001)
)
```

The request error budget is **0.1%**, or one server-failed request per 1,000 completed user-facing requests. For a continuously requested service, 99.9% corresponds to 43 minutes and 12 seconds of unavailable time in a 30-day period; request-based measurement remains authoritative.

## Latency objectives

For completed user-facing requests over a rolling 30-day window:

- at least **95%** complete within **500 ms**;
- at least **99%** complete within **2 seconds**.

The histogram is measured at the gateway and includes gateway processing plus any synchronous downstream work completed before the response finishes. Streaming and long-running asynchronous operations require separate objectives before introduction.

```promql
sum(rate(life_os_http_request_duration_seconds_bucket{
  service="life-os-gateway",
  route!~"/v1/(health|metrics)",
  le="0.5"
}[30d]))
/
clamp_min(sum(rate(life_os_http_request_duration_seconds_count{
  service="life-os-gateway",
  route!~"/v1/(health|metrics)"
}[30d])), 0.000001)
```

```promql
sum(rate(life_os_http_request_duration_seconds_bucket{
  service="life-os-gateway",
  route!~"/v1/(health|metrics)",
  le="2"
}[30d]))
/
clamp_min(sum(rate(life_os_http_request_duration_seconds_count{
  service="life-os-gateway",
  route!~"/v1/(health|metrics)"
}[30d])), 0.000001)
```

## Alert policy

`infra/observability/alerts.yml` implements the first error-budget gates.

- `LifeOsGatewayTargetDown` pages the operator when the gateway reports down or disappears from service discovery for five minutes. Verify process, discovery, network, and metrics-route reachability.
- `LifeOsGatewayAvailabilityFastBurn` pages immediately when the five-minute and one-hour server-error ratios exceed a 14.4x burn rate. Stop risky rollout activity and mitigate user impact.
- `LifeOsGatewayAvailabilitySlowBurn` opens an operational incident when the 30-minute and six-hour server-error ratios exceed a 6x burn rate. Assign remediation within the same working period.
- `LifeOsGatewayLatencyBudgetBurn` opens an operational incident when more than 30% of requests exceed 500 ms for 15 minutes. Investigate saturation and downstream latency.
- `LifeOsGatewayTailLatencyBudgetBurn` opens an operational incident when more than 1% of requests exceed 2 seconds for 15 minutes. Investigate tail latency because the 99% objective is being violated.

A page is actionable only when the operator has access to the deployment, current release identifier, gateway logs, and recent change history. Alert delivery and dashboards remain deployment responsibilities until a reference production stack is added.

## Incident and error-budget policy

1. Confirm the alert from raw Prometheus data and check whether the metrics target itself is failing.
2. Capture the response `x-correlation-id` from an affected client and locate the matching `http.request.completed` JSON record. The record can identify the bounded gateway route, response status, and gateway duration without disclosing arbitrary request data.
3. Treat an `observability.failure` record as evidence that a metric, request-context, or request-log operation failed. The record intentionally omits exception details; use deployment health and controlled diagnostics rather than expanding the production log schema with secrets or request data.
4. Mitigate user impact first through rollback, traffic reduction, or dependency isolation; preserve evidence for diagnosis.
5. Record the start, detection, mitigation, recovery, affected routes, release identifier, correlation identifiers used as evidence, and consumed error budget.
6. When the rolling availability budget is exhausted, freeze reliability-risking feature releases until the responsible failure mode is corrected and verified. Security fixes and changes that reduce user impact may proceed with explicit review.
7. Review recurring alerts and adjust implementation or capacity. SLO targets may change only through a reviewed pull request and may not be weakened retroactively to hide a miss.

## Deployment requirements

- Replace the reference static target `gateway:4000` with production service discovery while preserving the `life-os-gateway` job and service label contracts.
- Load `alerts.yml` from the same trusted configuration bundle as `prometheus.yml`.
- Restrict scrape access to the monitoring network and do not place credentials in Prometheus labels, query parameters, or repository files.
- Route standard output JSON records to access-controlled operational storage without adding request payloads, headers, exception text, or tenant fields.
- Define log retention and access policy before production deployment; correlation identifiers are operational metadata and must not become durable user identifiers.
- Retain enough metric history to evaluate the 30-day objectives and protect monitoring storage with the same operational controls as other production infrastructure.
- Validate Prometheus configuration and rules with `promtool check config` and `promtool check rules` in the production-image build or deployment pipeline.

## Deferred coverage

HTTP trace-context parsing, downstream correlation propagation, OpenTelemetry exporters, synthetic user journeys, service-specific saturation metrics, browser performance, downstream service objectives, alert delivery, dashboards, release annotations, and managed long-term metric and log storage are subsequent reviewable slices tracked by issue #64.
