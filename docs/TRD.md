# LifeOS Technical Requirements Document

**Status:** Implemented on active PR

This TRD defines repository-wide technical requirements. Protected-main code, migrations, tests, workflow policy, and owning-service runbooks remain the implementation authority.

## Runtime baseline

LifeOS is a TypeScript-first monorepo with a Next.js PWA/BFF, independently bounded services, service-owned PostgreSQL persistence, and NATS JetStream where durable asynchronous delivery is required. Optional providers include Google/GitHub identity, Google/CalDAV calendar, NVIDIA NIM through reviewed AI boundaries, and versioned plugins.

## Bounded contexts

- **Web/PWA:** interaction state, accessibility/localization, and explicitly local drafts/cache; no database authority.
- **Gateway/BFF:** authenticated public composition and short-lived service-context derivation; no shared domain store.
- **Identity:** users, provider mappings, sessions, workspace authority, authentication provenance, data-rights request/receipt orchestration, and export-integrity composition.
- **Planning:** Goals, Projects, Tasks, search, durable Today, and a protected data-rights contributor.
- **Habit:** recurring definitions/completions and a protected data-rights contributor.
- **Review:** guided-review persistence/projections; PR #195 is **Implemented on active PR** for its contributor.
- **Calendar Integration:** synchronization, connection metadata, workspace/user authority, credential ports, read/create/disconnect surfaces; complete hosted provider lifecycle remains **Partial** under #129.
- **Notification:** reminder occurrences/claims/outcomes; PR #198 is **Implemented on active PR** for its contributor.
- **AI Proposal:** inert proposals/evidence/decisions/evaluation; PR #199 is **Implemented on active PR** for its contributor.
- **Privacy:** purpose-bound sensitive-access decisions/grants/events.
- **Plugin Integration:** contracts, installation/grant/credential/operator authority; delivery runtime remains **Partial** under #130.

## Persistence and data requirements

1. Each service owns schemas/roles, migrations, repositories, credentials, transaction boundaries, backup semantics, and shutdown behavior.
2. Cross-service table reads, writes, joins, foreign keys, triggers, and shared mutation roles are prohibited.
3. Internal durable identifiers are opaque UUIDv4.
4. Product-owned database objects use descriptive multiword `snake_case`.
5. Instants use UTC; civil-time behavior also retains explicit IANA timezone/local-calendar evidence.
6. Immutable audit/decision/completion/receipt evidence rejects mutation. Mutable state uses revision, digest, ETag, idempotency, advisory locking, or fencing where loss/replay is plausible.
7. Browser-local state is not durable until the owning service accepts it.
8. External credentials remain behind least-authority secret-store/KMS ports and never become identity or primary-key material.
9. Persisted external identifiers are bounded metadata; opaque secret references are separate fields with separate authority.
10. Corrupt or ambiguous persisted evidence fails closed before it can become application authority.

## Authentication and authorization

- OAuth callbacks validate state, provider, redirect/origin, and bounded transaction lifetime.
- Browser sessions are revocable and server-verifiable.
- Authentication ceremony time survives compatible session rotation.
- Browser-selected workspace, actor, installation, connection, or request identifiers are never ownership authority.
- Signed private contexts bind exact workspace/actor, method, path, issuance, version, and one-time evidence where destructive replay matters.
- Planning protected authority comes from PR #168 and exact request binding from PR #188.
- Habit protected authority comes from PR #173; destructive contributor transport is protected by PR #192.
- Review exact request-bound authority is protected by PR #185.
- Calendar user-sensitive operations use `life-os.calendar-user.v1` from PR #155.
- Integration event authority is exact-request-bound through PR #190.
- Plugin operator authority is one-time and replay-protected through PR #191 and fail-closed HTTP composition through PR #196.

## HTTP and application boundaries

- Bound request bodies and provider/model responses before retention.
- Derive authority from authenticated or signed context.
- Reject unsupported media types and malformed JSON with bounded credential-free problems.
- Use explicit replay and stale-write controls.
- Do not forward browser cookies or provider secrets to downstream services.
- Never expose dependency bodies, stack traces, credentials, internal origins, secret handles, or raw tenant payloads in public failures.
- Version breaking shared-contract semantics; unknown versions fail closed.
- Sensitive status resources are non-cacheable and omit unrelated authority/digest/idempotency internals.

### Today composition

**Status:** Implemented on protected main

PR #186 composes authenticated Planning Today state and PR #187 composes authenticated Habit Today state. The Gateway derives authority from the authenticated session, signs exact downstream requests, validates bounded responses, and does not fabricate success. Issue #163 is completed.

### Data-rights contributor transport

**Status:** Partial

PR #159 defines `life-os.data-rights-contributor.v1` with explicit export, erase-preflight, erase, and verify-erased operations. Planning production contribution is protected through PR #179 and authenticated request-bound transport through PR #194. Habit production contribution is protected through PR #184 and transport/replay hardening through PR #192.

PR #195, PR #198, and PR #199 are **Implemented on active PR** for Review, Notification, and AI contributions. They remain non-shipped until integration. Whole-product completion remains **Partial** under #55.

### Calendar connection lifecycle

**Status:** Partial

Protected main includes:

- workspace/user scoped metadata persistence from PR #150;
- atomic local revoke from PR #153;
- signed user authority from PR #155;
- authenticated disconnect from PR #157;
- exact lookup evidence validation from PR #176;
- authenticated bounded read from PR #189;
- scoped credential materialization port from PR #193;
- authenticated secret-first create from PR #197;
- reverse-order compensation on mismatched returned durable evidence from PR #201.

Concrete encrypted storage, OAuth/PKCE, refresh, provider cleanup, discovery/selection, and scoped synchronization remain **Partial** under #129.

### Plugin installation and operator lifecycle

**Status:** Partial

Protected main includes explicit host grants (PR #151), durable installation persistence (PR #169), opaque credential binding (PR #172), exact installation-evidence validation (PR #175), one-time operator authority/replay storage (PR #191), and authenticated fail-closed operator HTTP composition (PR #196).

The runtime still requires a concrete secret-store/KMS adapter, separately host-authorized delivery origins, SSRF/DNS-rebinding-safe outbound HTTPS, attempt/outcome persistence, retry/dead-letter, revocation fencing, and operator-visible delivery recovery under #130.

## Domain concurrency and idempotency

- **Today:** strong create/update preconditions, ordered locking, exact replay, stale conflict, and explicit reconciliation.
- **Habit completion:** tenant-scoped replay-safe persistence.
- **Notification:** expiring/fenced claims and duplicate-delivery refusal.
- **Calendar:** exact connection/workspace/user authority, secret-first create compensation, deterministic provider preconditions, and local revoke replay.
- **AI decisions:** exact proposal digest/revision, actor/workspace, and idempotency binding.
- **Data rights:** exact request/workspace/actor/contributor/replay identity, immutable terminal evidence, and owner-controlled erasure verification.
- **Plugin installation/operator:** exact installation/workspace/installer/manifest/grant/secret-binding/request evidence and atomic replay refusal.

## AI and repository automation requirements

ADR 0012 is authoritative. Model output is untrusted structured data. Deterministic validators, authorization, tests, independent review, merge, and release gates remain authoritative.

A strong single-route baseline precedes conducted/deeper orchestration. Evaluation records supported workflow stage, reasoning effort, decomposition, recursion depth, role-specific reasoning effort, model/worker selection, verifier topology, and access/communication topology. Unsupported controls remain explicit rather than simulated.

Scheduled development uses reviewed OpenCode or contextual-orchestrator with `NVIDIA_NIM_API_KEY`; `COPILOT_GITHUB_TOKEN` is prohibited. PR #200 is **Implemented on protected main** for allowing only the exact reviewed `opencode-ai` lifecycle script needed to materialize the pinned executable. Unrelated lifecycle scripts remain denied.

## Security and privacy requirements

- Treat external responses, stored JSON, environment values, model output, and connector results as untrusted.
- Keep SQL structure static and parameterized.
- Use least-privilege GitHub/runtime/database/network/file/subprocess permissions.
- No credential, browser session, secret reference, raw prompt/response, hidden reasoning, or unbounded tenant content enters public/CI/release evidence.
- Sensitive access is tenant/actor/purpose/resource/lifetime/audit bound.
- No service claims whole-right completion from partial or unknown contributor state.
- No manifest self-authorizes plugin capability or delivery origin.
- No local calendar revoke is promoted to provider revoke.

## Accessibility, localization, and offline behavior

Core journeys remain keyboard-operable with visible focus, semantic names, non-color-only state, and localized Korean/English live feedback. Offline/local drafts remain visibly distinct from durable workspace state. Stale asynchronous responses cannot overwrite newer owned UI state.

## Observability and operations

Services expose bounded health/readiness reflecting actual dependencies. Metrics are operator-only in production exposure. Logs are structured and credential-free. Logical backup/restore proves integrity and unsafe-target refusal but does not claim PITR. Compose is a self-hosted profile; Kubernetes is a provider-neutral reference, not managed surrounding infrastructure.

## Verification model

**Status:** Accepted architecture

`source_head_sha`, `pr_base_snapshot_sha`, independently resolved `live_base_tip_sha`, `integration_tree_sha`/synthetic identity, `workflow_checkout_sha`, `protected_main_sha`, and `release_source_sha` are separate authorities. PR #154 implements exact source and live-base compatibility separation. Issue #132 remains **Partial** for residual central scanner attribution taxonomy.

## Release requirements

Release requires one unchanged integrated protected head with required CI/security/review, exact configured coverage/docstrings, package/container build, SBOM/provenance/reproducibility, compatibility, migration/rollback/recovery, accessibility/localization, and operational acceptance. A single merged feature, queued job, documentation line, or model result is not release readiness.
