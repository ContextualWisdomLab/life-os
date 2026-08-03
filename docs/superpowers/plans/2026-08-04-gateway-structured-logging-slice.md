# Gateway structured logging slice

## Goal

Implement issue #66 as the next bounded observability slice after #65: provide async-safe request correlation and one credential-free completion record for every normal, failed, or client-aborted gateway request.

## Constraints

- Request context may contain only a validated UUIDv4 correlation identifier.
- Structured logs must accept a fixed schema rather than arbitrary objects.
- Request headers, query strings, payloads, concrete resource paths, tenant identifiers, actor identifiers, credentials, exception messages, and stacks must not be serialized.
- Logging, clock, context, and metric failures must not make an otherwise valid request unavailable.
- Unknown routes must remain collapsed to `/unmatched`.
- This slice does not claim downstream propagation, distributed tracing, managed retention, or product-wide correlation.

## Implementation

1. Add an `AsyncLocalStorage` request context to `@life-os/observability` and expose immutable `runWithRequestContext` and `getRequestContext` boundaries.
2. Add `CredentialFreeJsonLogger` with fixed HTTP completion and sanitized observability-failure records.
3. Validate the service, UUIDv4 correlation identifier, method, route template, status, duration, wall clock, writer, and operation vocabulary before serialization.
4. Run gateway request processing inside the request context and retain the generated-or-preserved identifier in the response header.
5. Emit exactly one completion record from the existing `finish`, `close`, and synchronous-failure guard. Keep synthetic status `499` for client-aborted responses.
6. Isolate metric recording and structured-log writer failures. Emit sanitized failure records when the logger remains available, without serializing the original error.
7. Update the SLO runbook so operators can correlate a client response with the bounded completion record and understand the limits of that evidence.

## Verification

- package tests prove async propagation, nested restoration, immutable context, invalid-input rejection, exact JSON schemas, bounded status levels, route rejection, sanitized failures, and writer-failure behavior;
- gateway tests prove context availability, one-record completion, route collapse, secret exclusion, client-abort accounting, metric-failure reporting, writer-failure isolation, and synchronous-failure de-duplication;
- package `typecheck` validates the CommonJS implementation and TypeScript declaration surface;
- CI runs formatting, lint, type checking, tests, build, AppGuardrail, Semgrep, security scanning, commercial readiness, and CodeRabbit on the exact pull-request head.

## Deferred

HTTP `traceparent` parsing, correlation propagation headers to downstream services, service-to-service client instrumentation, OpenTelemetry exporters, sampling, remote log storage, retention automation, dashboards, release annotations, synthetic journeys, and alert delivery remain follow-up slices in issue #64.
