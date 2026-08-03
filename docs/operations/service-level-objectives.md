# LifeOS gateway service-level objectives

## Scope and status

This specification governs the user-facing LifeOS gateway. It is the first observability slice and does not claim coverage for identity, planning, habit, review, AI, calendar, notification, or browser-only workflows. Those services must adopt the shared telemetry boundary before their reliability can be included in a product-wide objective.

The source of truth is the Prometheus exposition at `GET /v1/metrics`, scraped by `infra/observability/prometheus.yml`. Health and metrics requests are operational probes and are excluded from user-facing service-level indicators.

## Telemetry trust boundary

- Metrics use only the fixed service name, a bounded HTTP method, a route template, and the response status class.
- Concrete UUIDs, numeric identifiers, query strings, workspace identifiers, actor identifiers, cookies, authorization values, session values, and correlation identifiers are forbidden as metric labels.
- Unknown gateway paths collapse to `/unmatched`; they never become a new label value.
- `x-correlation-id` is an opaque UUIDv4 used for request correlation. It is not authentication or authorization evidence.
- The metrics endpoint contains operational data and must be reachable only from the monitoring network in production. Public ingress must deny `/v1/metrics`.
- Metric retention, remote storage, and alert delivery must not introduce tenant data or credentials.

## Availability objective

**Objective:** at least **99.9%** of completed user-facing gateway requests succeed over a rolling 30-day window.

A request is good when its response status class is not `5xx`. A request is total when it reaches the gateway and completes on a route other than `/v1/health` or `/v1/metrics`. Client failures (`4xx`) remain in the denominator and are treated as available because the gateway produced a bounded response; separate product telemetry must detect unusable client flows.

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

## Alert policy

`infra/observability/alerts.yml` implements the first error-budget gates.

| Alert | Condition | Response |
| --- | --- | --- |
| `LifeOsGatewayTargetDown` | Prometheus cannot scrape the gateway for 5 minutes | Page the operator; verify process, network, and metrics-route reachability. |
| `LifeOsGatewayAvailabilityFastBurn` | 5-minute and 1-hour server-error ratios exceed a 14.4x burn rate | Page immediately; stop risky rollout activity and mitigate user impact. |
| `LifeOsGatewayAvailabilitySlowBurn` | 30-minute and 6-hour server-error ratios exceed a 6x burn rate | Open an operational incident and assign remediation within the same working period. |
| `LifeOsGatewayLatencyBudgetBurn` | More than 30% of requests exceed 500 ms for 15 minutes | Investigate saturation and downstream latency; prevent continued budget depletion. |

A page is actionable only when the operator has access to the deployment, current release identifier, gateway logs, and recent change history. Alert delivery and dashboards remain deployment responsibilities until a reference production stack is added.

## Incident and error-budget policy

1. Confirm the alert from raw Prometheus data and check whether the metrics target itself is failing.
2. Use the response `x-correlation-id` to locate matching credential-free application logs. Correlation propagation into every downstream service is a required follow-up and must not be assumed before it is implemented.
3. Mitigate user impact first through rollback, traffic reduction, or dependency isolation; preserve evidence for diagnosis.
4. Record the start, detection, mitigation, recovery, affected routes, release identifier, and consumed error budget.
5. When the rolling availability budget is exhausted, freeze reliability-risking feature releases until the responsible failure mode is corrected and verified. Security fixes and changes that reduce user impact may proceed with explicit review.
6. Review recurring alerts and adjust implementation or capacity. SLO targets may change only through a reviewed pull request and may not be weakened retroactively to hide a miss.

## Deployment requirements

- Replace the reference static target `gateway:4000` with production service discovery while preserving the `life-os-gateway` job and service label contracts.
- Load `alerts.yml` from the same trusted configuration bundle as `prometheus.yml`.
- Restrict scrape access to the monitoring network and do not place credentials in Prometheus labels, query parameters, or repository files.
- Retain enough history to evaluate the 30-day objectives and protect monitoring storage with the same operational controls as other production infrastructure.
- Validate Prometheus configuration and rules with `promtool check config` and `promtool check rules` in the production-image build or deployment pipeline.

## Deferred coverage

Distributed trace propagation, structured log correlation, synthetic user journeys, service-specific saturation metrics, browser performance, downstream service objectives, alert delivery, dashboards, release annotations, and long-term metric storage are subsequent reviewable slices tracked by issue #64.
