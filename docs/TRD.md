# LifeOS Technical Requirements Document

**Status:** Implemented on active PR

## Purpose

This document defines repository-wide technical requirements. Owning-service code, migrations, tests, versioned contracts and runbooks remain the implementation authority.

## Runtime baseline

LifeOS is a TypeScript-first monorepo with a Next.js PWA/BFF, independently bounded services, PostgreSQL service-owned persistence and NATS JetStream where durable asynchronous events are required. Optional external providers include Google/GitHub identity, Google/CalDAV calendar providers, NVIDIA NIM through approved AI boundaries, and versioned plugins.

## Bounded contexts

- **Web/PWA:** interaction state and explicitly local drafts/cache; never direct DB authority.
- **Gateway/BFF:** public composition and authenticated context derivation; not a shared domain store.
- **Identity:** internal users, external identity mappings, sessions, workspace membership/authorization context, authentication provenance and data-rights request/receipt authority.
- **Planning:** Goals, Projects, Tasks, durable Today aggregate and search.
- **Habit:** recurrence definitions and completion evidence.
- **Review:** review snapshots/projections; no direct planning mutation.
- **Calendar integration:** provider adapters, sync state and trusted workspace context. Per-user hosted credential lifecycle remains partial under #129.
- **Notification:** reminder occurrences, claims, outcomes and delivery recovery.
- **AI proposal:** proposals, evidence, explicit decisions and deterministic evaluation; no generic planning mutation authority.
- **Privacy:** purpose-bound sensitive-access decisions/grants/events.
- **Plugin integration:** versioned plugin contracts and validation; installation/secrets/outbound delivery remain planned under #130.

## Data requirements

1. Each service owns persistence, migrations and DB credentials; cross-service table access is prohibited.
2. Internal durable identifiers are opaque UUIDv4.
3. Product-owned database objects use descriptive multiword `snake_case`.
4. Persist instants in UTC and IANA timezone/local-calendar values where civil-time semantics matter.
5. Immutable audit/decision/completion/receipt evidence rejects mutation; mutable state uses explicit revision/digest/ETag/idempotency/fencing where loss or replay is plausible.
6. Browser-local state is not durable until the owning service accepts it.
7. Logical cross-service references do not create physical foreign-key or SQL authority across service-owned schemas.

## Authentication and authorization

- OAuth/OIDC callbacks validate state, provider and redirect boundaries.
- Browser sessions are revocable and server-verifiable.
- Authentication ceremony time is preserved separately from compatible session issuance/rotation time.
- Client-selected workspace/actor identifiers are never trusted as authority.
- Signed private context binds exact actor/workspace/method/path and bounded issuance time where service separation requires it.
- Calendar synchronization uses the trusted signed workspace context implemented on protected main; legacy workspace headers cannot override it.
- Sensitive operations add purpose/resource/tenant authorization and, for data rights, recent-authentication policy derived from authentication provenance rather than session rotation.

## HTTP/API requirements

- Bound bodies and provider responses before retention.
- Derive ownership from authenticated/signed context.
- Use replay protection for repeatable mutations.
- Use explicit stale-write preconditions where silent overwrite is unacceptable.
- Return bounded credential-free problems.
- Never expose dependency bodies, tokens, stack traces or internal URLs.
- Version breaking shared-contract semantics.
- Sensitive status resources use non-cacheable semantics and omit unrelated tenant/credential/idempotency/digest internals.

### Data-rights public status

**Status:** Implemented on active PR

PR #146 advances issue #55 from the protected-main tenant-and-actor scoped ledger lookup to a browser-facing authenticated resource. The boundary must:

- derive workspace and requesting-user scope exclusively from validated session introspection;
- combine request ID, session workspace and session user in the ledger query without a widening lookup;
- expose only request ID, request kind, lifecycle status and bounded timestamps;
- reject malformed request IDs before SQL;
- make absent and cross-tenant requests indistinguishable;
- return sanitized bounded dependency failures;
- apply `Cache-Control: no-store` on every response path.

This endpoint is one lifecycle surface and does not imply complete cross-domain export/erasure orchestration.

## Event requirements

Versioned events carry opaque event ID, explicit type/version, validated actor/workspace/correlation/causation context and immutable payload semantics. Consumers are idempotent under replay. Cross-service events never grant direct database mutation authority.

## Domain concurrency/idempotency

- **Today:** protected-main aggregate uses explicit strong create/update preconditions, idempotency and stale-conflict handling with durable PostgreSQL concurrency evidence.
- **Habit completion:** tenant-scoped replay-safe persistence.
- **Notification:** expiring/fenced claims and duplicate-delivery refusal.
- **Calendar:** deterministic provider identity/preconditions and trusted context.
- **AI decisions:** bind decision to exact proposal digest/revision, actor/workspace and idempotency identity.
- **Data rights:** durable request identity and immutable terminal receipts; status lookup is scoped simultaneously by request, workspace and requesting user and fails closed on corruption.

## AI / automation requirements

Model output is untrusted structured data. Deterministic validators and user/product authorization remain authoritative. Live provider availability is separated from deterministic merge gates. Scheduled autonomous development uses reviewed OpenCode with `NVIDIA_NIM_API_KEY`; `COPILOT_GITHUB_TOKEN` is prohibited as a development-model credential. A strong single-route baseline precedes deeper orchestration and evaluation records role, stage, reasoning effort, decomposition, recursion and access topology.

## Security/privacy requirements

- Treat external responses, stored JSON, environment values, model output and connector results as untrusted.
- Keep SQL structure static and parameterized.
- Use least-privilege GitHub/runtime/database permissions and bounded network/file/subprocess behavior.
- Public artifacts exclude credentials, raw model prompts/responses, hidden reasoning and unbounded tenant data.
- Sensitive access is purpose/lifetime/resource scoped with audit evidence; blanket masking is not the primary control.
- Data-rights end-to-end domain participation, durable reconciliation, retention/legal hold and protected export delivery remain partial under #55.

## Web/accessibility/localization

Core journeys remain keyboard operable with visible focus and non-color-only state. Korean/English catalogs remain structurally aligned. Offline/local drafts must never imply durable sync until server acceptance. Stale async responses cannot overwrite newer owned UI state.

## Observability and operations

Services expose bounded health/readiness appropriate to actual dependencies. Metrics are operator-only in production exposure. Logs are structured, bounded and credential-free. Logical backup/restore proves integrity and unsafe-target refusal; it does not imply PITR. Compose is a self-hosted composition profile and Kubernetes artifacts are a provider-neutral reference rather than managed infrastructure provisioning.

## Verification model

**Status:** Accepted architecture

Required evidence classes are distinct and retain explicit identities:

- `source_head_sha`: exact contributor/source branch head for direct source verification;
- `pr_base_snapshot_sha`: GitHub PR/event base snapshot, historical once the live base moves;
- `live_base_tip_sha`: independently resolved current base-ref tip for base-sensitive decisions;
- `merge_tree_sha`: synthetic integration tree used only for separately classified compatibility evidence;
- `workflow_checkout_sha`: exact tree inspected by one evidence-producing job;
- `protected_main_sha`: integrated protected-main evidence identity;
- `release_source_sha`: exact protected source bound to release artifacts.

A green result for one class cannot be promoted to another. SARIF/security evidence must be uploaded against the commit/ref actually analyzed. PR #147 is `Implemented on active PR` for the current source-head/merge-tree workflow correction and AppGuardrail SARIF attribution; issue #132 remains open until protected-main integration and remaining required-workflow attribution are reconciled.

## Release requirements

Release requires one unchanged integrated protected head with required CI/security/review, exact configured coverage, package/container build, migration/rollback/recovery, accessibility/localization, SBOM/provenance/reproducibility and operational acceptance. A single merged feature or documentation PR is not release readiness.
