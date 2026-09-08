# LifeOS Technical Requirements Document

**Status:** Implemented on active PR

This TRD defines repository-wide technical requirements. Protected-main code, migrations, tests, workflow policy, and owning-service runbooks remain the implementation authority.

## Runtime baseline

LifeOS is a TypeScript-first monorepo with a Next.js PWA/BFF, independently bounded services, service-owned PostgreSQL persistence, and NATS JetStream where durable asynchronous delivery is required. Optional providers include Google/GitHub identity and Google/CalDAV calendar. Model capability is consumed through the reviewed contextual-orchestrator boundary rather than direct provider selection in product/runtime code; plugins use versioned host-owned contracts.

## Bounded contexts

- **Web/PWA:** interaction state, accessibility/localization, and explicitly local drafts/cache; no database authority. The complete first-party buyer journey remains **Partial** under #209.
- **Gateway/BFF:** authenticated public composition and short-lived service-context derivation; no shared domain store.
- **Identity:** users, provider mappings, sessions, workspace authority, authentication provenance, data-rights request/receipt orchestration, and export-integrity composition.
- **Planning:** Goals, Projects, Tasks, search, durable Today, and a protected data-rights contributor.
- **Habit:** recurring definitions/completions and a protected data-rights contributor.
- **Review:** guided-review persistence/projections and a protected Review-owned contributor from PR #195.
- **Calendar Integration:** synchronization, connection metadata, workspace/user authority, credential ports, read/create/disconnect surfaces; complete hosted provider lifecycle remains **Partial** under #129, with active #216/#228 narrowing hosted credential and OAuth state/PKCE boundaries.
- **Notification:** reminder occurrences/claims/outcomes; PR #198 is **Implemented on active PR** for its contributor.
- **AI Proposal:** inert proposals/evidence/decisions/evaluation; PR #199 is **Implemented on active PR** for its contributor.
- **Privacy:** purpose-bound sensitive-access decisions/grants/events.
- **Plugin Integration:** contracts, installation/grant/credential/operator authority; active #205/#235/#241/#242/#243/#244/#245/#250 narrow durable origin, Vault, PostgreSQL and signed operator composition while outbound delivery remains **Partial** under #130.

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
11. A service-owned PostgreSQL pool may back multiple repositories inside one bounded context; cross-service SQL or mutable sibling-source coupling is still prohibited.

## Authentication and authorization

- OAuth callbacks validate state, provider, redirect/origin, bounded transaction lifetime, exact user/workspace authority, and one-time consumption before credential exchange.
- Browser sessions are revocable and server-verifiable.
- Authentication ceremony time survives compatible session rotation.
- Browser-selected workspace, actor, installation, connection, request, grant, or credential identifiers are never ownership authority.
- Signed private contexts bind exact workspace/actor, method, path, issuance, version, and one-time evidence where destructive replay matters.
- Planning protected authority comes from PR #168 and exact request binding from PR #188.
- Habit protected authority comes from PR #173; destructive contributor transport is protected by PR #192.
- Review exact request-bound authority is protected by PR #185.
- Calendar user-sensitive operations use `life-os.calendar-user.v1` from PR #155.
- Integration event authority is exact-request-bound through PR #190.
- Plugin operator authority is one-time and replay-protected through PR #191 and fail-closed HTTP composition through PR #196. Active #250 extends the internal application verifier to exact signed delivery-origin collection/item/revoke routes but does not yet expose their HTTP transport.

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

PR #159 defines `life-os.data-rights-contributor.v1` with explicit export, erase-preflight, erase, and verify-erased operations. Planning production contribution is protected through PR #179 and authenticated request-bound transport through PR #194. Habit production contribution is protected through PR #184 and transport/replay hardening through PR #192. Review production contribution is protected through PR #195.

PR #198 and PR #199 are **Implemented on active PR** for Notification and AI contributions. They remain non-shipped until integration. Whole-product completion remains **Partial** under #55.

### First-party buyer journey

**Status:** Partial

Issue #209 requires a dependency-ordered authenticated Goals → Projects → Tasks → Habits → Review journey. Active PR #214 establishes the first-party Goal BFF and keeps workspace authority/request signing server-side. The stacked buyer-path line reaches the durable `/goals` workspace at PR #229 and `/review` at PR #234. Browser reducers accept only bounded durable server evidence, reject stale/duplicate/malformed authority, preserve safe prior evidence on failures, and do not manufacture durable IDs.

The stack remains non-shipped. Final acceptance requires exact-head browser E2E after prerequisite restacks, Figma/Storybook traceability, normal/loading/empty/error/permission/responsive/interaction states, keyboard/focus/reduced-motion/a11y coverage, authoritative Review read projections, and KO/EN/JA/ZH/VI/ES/DE/FR DB-versioned translation-ledger/font/text-expansion parity.

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
- reverse-order compensation on mismatched returned durable evidence from PR #201;
- Calendar-owned AES-256-GCM encrypted self-hosted credential storage from PR #203.

Active PR #216 fails hosted multi-user startup closed when deployment-wide Google/CalDAV credentials would otherwise substitute for user-owned authority. Stacked PR #228 adds five-minute OAuth state/PKCE authority with opaque durable state and secret-store-held verifier material and revalidates consumed repository evidence before secret materialization.

Hosted callback/token exchange, successful post-exchange verifier cleanup, concrete PostgreSQL OAuth-state persistence, refresh fencing, provider revoke/delete recovery, discovery/selection, scoped synchronization, and complete KMS/runtime composition remain **Partial** under #129.

### Plugin installation and operator lifecycle

**Status:** Partial

Protected main includes explicit host grants (PR #151), durable installation persistence (PR #169), opaque credential binding (PR #172), exact installation-evidence validation (PR #175), one-time operator authority/replay storage (PR #191), and authenticated fail-closed operator HTTP composition (PR #196).

The active stack adds host-owned delivery-origin authority (#205), PostgreSQL grant persistence/active-installation fencing (#235), credential/revocation hardening (#241), Vault KV v2 secret storage (#242), authenticated Vault composition (#243), one Integration-owned hosted PostgreSQL pool (#244), and a concrete hosted/default-entrypoint runtime with retained exact ancestor real Vault + migrated PostgreSQL lifecycle evidence (#245). Draft #250 adds exact signed delivery-origin grant/read/revoke application authority and canonical route verification.

No active slice yet authorizes arbitrary outbound HTTP. #130 still requires immutable/versioned egress authority, connect-time DNS/IP/rebinding checks, redirect/proxy controls, bounded time/response handling, delivery attempt/outcome persistence, retries/dead-letter, revocation fencing at the network boundary, and operator-visible recovery. Durable origin grant identity is necessary but not sufficient network authority.

## Domain concurrency and idempotency

- **Today:** strong create/update preconditions, ordered locking, exact replay, stale conflict, and explicit reconciliation.
- **Habit completion:** tenant-scoped replay-safe persistence.
- **Notification:** expiring/fenced claims and duplicate-delivery refusal.
- **Calendar:** exact connection/workspace/user authority, secret-first create compensation, bounded OAuth ceremony state, deterministic provider preconditions, and local revoke replay.
- **AI decisions:** exact proposal digest/revision, actor/workspace, and idempotency binding.
- **Data rights:** exact request/workspace/actor/contributor/replay identity, immutable terminal evidence, and owner-controlled erasure verification.
- **Plugin installation/operator:** exact installation/workspace/installer/manifest/grant/secret-binding/request evidence, atomic replay refusal, and active-installation revalidation across credential/origin admission races.

## AI and repository automation requirements

ADR 0012 is authoritative. Model output is untrusted structured data. Deterministic validators, authorization, tests, independent review, merge, and release gates remain authoritative.

A strong single-route baseline precedes conducted/deeper orchestration. Evaluation records supported workflow stage, reasoning effort, decomposition, recursion depth, role-specific reasoning effort, model/worker selection, verifier topology, and access/communication topology. Unsupported controls remain explicit rather than simulated.

Protected PR #200 preserves the exact reviewed OpenCode bootstrap boundary. The target scheduled-development architecture is the active #208 line: exact OpenCode identity with model calls routed only through a reviewed immutable contextual-orchestrator API/client and virtual `orchestrator/free`. Provider credentials are contextual-orchestrator bootstrap material, not LifeOS model-selection authority. The current LifeOS consumer remains Draft until the canonical owner fixes its authentication/bootstrap contract, publishes an immutable reviewed release, and the exact released consumer passes hosted acceptance. Mutable owner source copying and direct-provider fallback are prohibited.

## Security and privacy requirements

- Treat external responses, stored JSON, environment values, model output, and connector results as untrusted.
- Keep SQL structure static and parameterized.
- Use least-privilege GitHub/runtime/database/network/file/subprocess permissions.
- No credential, browser session, secret reference, raw prompt/response, hidden reasoning, or unbounded tenant content enters public/CI/release evidence.
- Sensitive access is tenant/actor/purpose/resource/lifetime/audit bound.
- No service claims whole-right completion from partial or unknown contributor state.
- No manifest self-authorizes plugin capability or delivery origin.
- No durable delivery-origin grant self-authorizes a resolved IP, redirect target, proxy route, or later rebinding result.
- No local calendar revoke is promoted to provider revoke.

## Accessibility, localization, and offline behavior

Core journeys remain keyboard-operable with visible focus, semantic names, non-color-only state, and bounded localized feedback. The complete commercial locale target is KO/EN/JA/ZH/VI/ES/DE/FR with CJK/font fallback and text-expansion acceptance. Translation resources use a DB-versioned screen-key ledger/cache and remain distinct from ontology label ledgers. Offline/local drafts remain visibly distinct from durable workspace state. Stale asynchronous responses cannot overwrite newer owned UI state.

## Observability and operations

Services expose bounded health/readiness reflecting actual dependencies. Metrics are operator-only in production exposure. Logs are structured and credential-free. Logical backup/restore proves integrity and unsafe-target refusal but does not claim PITR. Compose is a self-hosted profile; Kubernetes is a provider-neutral reference, not managed surrounding infrastructure.

## Verification model

**Status:** Accepted architecture

`source_head_sha`, `pr_base_snapshot_sha`, independently resolved `live_base_tip_sha`, `integration_tree_sha`/synthetic identity, `workflow_checkout_sha`, `protected_main_sha`, and `release_source_sha` are separate authorities. PR #154 implements exact source and live-base compatibility separation. Issue #132 remains **Partial** for residual central scanner attribution taxonomy.

## Release requirements

Issue #210 is **Partial**. Active Draft #217 adds a structural release-evidence index/validator and stacked #236 adds detached Ed25519 verification/operator tooling. A release still requires one unchanged integrated protected head with version/CHANGELOG/tag/package/immutable publication plus required CI/security/review, exact configured coverage/docstrings, package/container build, SBOM/provenance/signatures/reproducibility, compatibility, migration/rollback/recovery, accessibility/localization, deployment, and operational acceptance. A feature PR, queued job, ancestor GREEN, documentation line, or model result is not release readiness.
