# AI service documentation and 100% coverage design

**Date:** 2026-08-04  
**Status:** Approved under the autonomous commercial-readiness mandate  
**Tracking issue:** #107

## Product objective

The production AI proposal-audit boundary must be reviewable by an acquirer without relying on undocumented behavior or optimistic test claims. Every production declaration is explained, every executable production path is covered, and the operator documentation links the implementation to current authoritative AI-governance and HTTP-error standards.

This slice does not add an external model, a mutation executor, or a new user-facing workflow. It strengthens the already merged `apps/ai-service` bounded context as an independently deployable service and as a reusable LifeOS module.

## Bounded-context architecture

`apps/ai-service` continues to own only inert proposal generation and append-only proposal/decision evidence. It receives no planning, calendar, habit, identity, notification, generic repository, command-bus, event-bus, or user-data mutation dependency.

The domain layer owns technology-independent proposal and decision semantics. A stale immutable proposal revision is therefore represented by `ProposalDigestMismatchError` in `proposal-audit-domain.ts`. The PostgreSQL repository imports and re-exports that domain error for compatibility, but application code does not depend on the PostgreSQL implementation module.

All existing database identifiers remain multi-word `snake_case`. This slice creates no new database object.

## Executable documentation contract

A dedicated `docstring-coverage.test.ts` parses production TypeScript with the TypeScript compiler API. It requires JSDoc for:

- top-level functions, classes, interfaces, type aliases, and callable variable declarations;
- constructors, methods, method signatures, and callable properties directly owned by classes or interfaces.

The contract excludes `*.test.ts` and nested expression declarations. This keeps the gate focused on public behavior and maintainable component boundaries instead of forcing noise comments into local callbacks and fixtures.

## Complete coverage contract

`vitest.config.ts` enables V8 coverage with exact thresholds of 100% for statements, branches, functions, and lines. Production files under `src/**/*.ts` are included; test files are excluded. No production source file or branch receives a coverage exemption.

The AI package test command runs serially with coverage because PostgreSQL integration tests mutate a disposable test schema and deterministic ordering is more valuable than test-process parallelism. `@vitest/coverage-v8` is declared directly by the AI package rather than relying on another workspace package's dependency.

Coverage failures are resolved through realistic evidence:

- malformed and oversized input;
- invalid clocks, identifiers, digests, and persisted rows;
- exact idempotent replay and conflicting replay;
- stale proposal revision handling;
- PostgreSQL failure mapping;
- pool error classification and shutdown retry/concurrency;
- unknown error sanitization;
- HTTP tenant isolation and absence of apply/execute routes.

## Governance and HTTP evidence

The operator documentation states the implemented control boundary and the limits that remain outside this slice:

- proposals are inert and require separate human authorization before any future execution;
- immutable proposal content and append-only decisions provide traceability but do not by themselves prove model quality, fairness, or legal compliance;
- tenant and actor headers are trusted only behind a private authenticated gateway;
- RFC 9457 problem responses remain bounded and must not expose stack traces, database details, credentials, prompts, or tenant data;
- risk review is continuous and must be re-run when models, prompts, tools, data sources, or execution permissions change.

The documentation records APA 7th references to the standards used to justify traceability, risk treatment, lifecycle governance, and sanitized machine-readable errors.

## Commercial-readiness evidence

A new capability manifest entry, `quality.ai-audit-assurance`, makes the hourly commercial-readiness loop verify that implementation, 100% coverage configuration, executable documentation, and standards documentation remain present. Documentation alone cannot satisfy production maturity; the production target requires the executable coverage and JSDoc tests.

## Test and merge gates

The exact PR head must pass:

- Prettier formatting;
- TypeScript lint and type checking;
- AI service tests with 100% statement, branch, function, and line coverage;
- complete monorepo tests and build;
- Compose validation;
- AppGuardrail;
- SAST Semgrep;
- Security Scan;
- Commercial Readiness;
- CodeRabbit;
- every actionable review thread.

## Deferred scope

- external-model correctness, calibration, and NVIDIA NIM integration;
- prompt-injection and tool-execution policy evaluation;
- model-card, dataset-card, and fairness evaluation automation;
- cross-service OpenTelemetry traces and AI-specific production SLO dashboards;
- separately authorized proposal execution;
- independent human or third-party conformity assessment.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). _Artificial intelligence risk management framework: Generative artificial intelligence profile_ (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

International Organization for Standardization. (2023a). _Information technology—Artificial intelligence—Guidance on risk management_ (ISO/IEC 23894:2023). ISO.

International Organization for Standardization. (2023b). _Information technology—Artificial intelligence—Management system_ (ISO/IEC 42001:2023). ISO.

Nottingham, M., Wilde, E., & Dalal, S. (2023). _Problem details for HTTP APIs_ (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457
