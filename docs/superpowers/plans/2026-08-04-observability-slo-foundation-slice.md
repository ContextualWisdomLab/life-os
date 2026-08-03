# Observability and SLO foundation slice

## Goal

Implement issue #64 as the first production-facing observability boundary: bounded gateway metrics, correlation identifiers, Prometheus collection and alert rules, and an explicit operator SLO contract.

## Constraints

- Telemetry must not contain tenant, actor, session, credential, query-string, or concrete resource identifiers.
- Metric labels must remain bounded as routes and services grow.
- The gateway must continue to run without a monitoring backend.
- A scrape or metrics-rendering failure must not gain authority over user-owned data.
- This slice does not claim downstream service tracing or product-wide reliability coverage.

## Implementation

1. Add `@life-os/observability` as a framework-neutral CommonJS workspace package so CommonJS NestJS services can consume it without a runtime module bridge.
2. Validate service names, HTTP methods, route templates, status codes, duration buckets, clocks, and total series count before recording data.
3. Record request totals, duration histograms, and in-flight requests using fixed Prometheus metric names. Keep correlation identifiers out of labels.
4. Generate or preserve a UUIDv4 `x-correlation-id` at the gateway. Collapse every route outside the explicit gateway route inventory to `/unmatched`.
5. Expose the credential-free metrics text on `/v1/metrics` and require production ingress to restrict it to the monitoring network.
6. Provide a Prometheus scrape configuration and availability/latency burn alerts.
7. Define rolling objectives, exclusions, budgets, alert response, release policy, privacy constraints, and deferred coverage in the operator documentation.

## Verification

- package tests prove correlation replacement, deterministic counters and histograms, in-flight accounting, duplicate-completion safety, concrete identifier rejection, and the series cap;
- gateway tests prove bounded route mapping, safe correlation handling, `5xx` recording, and synchronous failure recovery;
- CI runs formatting, lint, type checking, tests, build, AppGuardrail, Semgrep, security scanning, commercial readiness, and CodeRabbit on the exact pull-request head;
- production deployment must additionally run `promtool check config` and `promtool check rules` against the shipped Prometheus image.

## Deferred

Instrumenting every service, trace-context propagation, OpenTelemetry exporters, structured logging, synthetic journeys, dashboards, alert delivery, remote storage, release annotations, and production service discovery remain follow-up slices in issue #64.
