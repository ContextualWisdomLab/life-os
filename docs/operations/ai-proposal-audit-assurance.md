# AI proposal audit assurance

## Control objective

The AI service generates inert proposals, records immutable provenance before response, and appends explicit accept or reject decisions without receiving any capability to execute the proposed operations. The service can run independently or behind the LifeOS gateway through the same bounded HTTP and PostgreSQL contracts.

## Implemented assurance boundary

- Proposal requests, model drafts, identifiers, timestamps, and persisted rows are revalidated at their trust boundaries.
- Canonical SHA-256 request and content digests bind each proposal to its workspace, model identifier, evidence, output, and creation time.
- `ai.proposal_audit_records` and `ai.proposal_decision_events` are append-only PostgreSQL objects with multi-word `snake_case` identifiers.
- Decision writes require the exact immutable proposal content digest and a UUIDv4 idempotency key. Exact replay returns the original event; conflicting replay fails closed.
- Workspace and actor scope arrive only through trusted headers. Public deployment therefore requires an authenticated private gateway that strips caller-supplied ownership headers and derives them from a verified session.
- RFC 9457 problem responses expose stable codes without prompts, stack traces, SQL details, credentials, model output, or another tenant's existence.
- No route, command bus, generic repository, or adapter can apply or execute a proposal.

## Human authorization separation

`requiresConfirmation: true` is an explicit product invariant, not an execution permission. An accepted decision is audit evidence only. A future execution capability must be separately designed, authenticated, authorized, idempotent, reviewable, and connected to bounded domain commands. It must never infer execution authority from the mere presence of an accepted decision.

## Executable quality evidence

`apps/ai-service/vitest.config.ts` requires 100% statements, branches, functions, and lines across all production TypeScript. No production file or branch is excluded. `src/docstring-coverage.test.ts` uses the TypeScript compiler API to require JSDoc on production top-level declarations and class/interface members while excluding tests and nested callbacks.

The test suite includes deterministic unit evidence and real disposable-PostgreSQL/HTTP scenarios for restart durability, tenant isolation, exact decision replay, conflicting replay, stale revisions, append-only enforcement, lifecycle shutdown, pool failures, malformed rows, sanitized errors, and absence of execution routes.

Run the package assurance gate with:

```bash
AI_DATABASE_URL=postgresql://... \
AI_TEST_DATABASE_URL=postgresql://... \
pnpm --filter @life-os/ai-service test
```

The integration database must be disposable and its database name must contain `test`. The suite refuses to drop the `ai` schema otherwise.

## Continuous risk review triggers

Re-run architecture, security, privacy, evaluation, and operational review whenever any of the following changes:

- model or model-provider version;
- system prompt, rubric, tool schema, or output schema;
- evidence source, retrieval policy, or retention period;
- proposal operation vocabulary;
- authenticated gateway or ownership derivation;
- decision policy or future execution permission;
- telemetry attributes, incident response, or production deployment topology.

## Limitations

Append-only provenance improves traceability but does not prove model correctness, calibration, fairness, usefulness, copyright compliance, privacy compliance, or freedom from prompt injection. This slice uses the deterministic local rule-based adapter and therefore does not exercise NVIDIA NIM or any external model. External-model introduction requires provider-specific accuracy, robustness, privacy, cost, latency, and adversarial tests before release.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). _Artificial intelligence risk management framework: Generative artificial intelligence profile_ (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

International Organization for Standardization. (2023a). _Information technology—Artificial intelligence—Guidance on risk management_ (ISO/IEC 23894:2023). ISO.

International Organization for Standardization. (2023b). _Information technology—Artificial intelligence—Management system_ (ISO/IEC 42001:2023). ISO.

Nottingham, M., Wilde, E., & Dalal, S. (2023). _Problem details for HTTP APIs_ (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457
