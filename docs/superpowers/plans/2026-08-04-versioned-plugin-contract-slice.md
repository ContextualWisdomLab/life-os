# Versioned plugin contract slice

## Goal

Give third parties a bounded, versioned integration surface that does not require direct database access.

## Scope

- publish a reusable `@life-os/plugin-sdk` manifest validator
- require opaque plugin identifiers, semantic versions, explicit permissions, and supported webhook event types
- reject private, loopback, credential-bearing, query-bearing, or otherwise unsafe callback targets before registration
- expose tenant-scoped `POST /v1/plugins` and `GET /v1/plugins` endpoints
- verify workspace isolation, duplicate refusal, SSRF refusal, and stable error envelopes in an HTTP integration test

## Safety boundary

This slice registers contracts only. It does not dispatch webhooks, mint credentials, execute third-party code, persist registrations across restarts, or grant a plugin direct access to service databases. A durable repository, signed delivery, replay protection, outbound egress policy, and secret rotation remain later slices.

## Acceptance gate

Formatting, linting, type checking, unit tests, the real HTTP integration test, build, Compose validation, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all actionable human or security feedback must pass on the exact merge head.
