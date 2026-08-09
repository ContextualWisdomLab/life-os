# LifeOS Privacy and Data Lifecycle

**Status:** Accepted architecture  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

## 1. Principles

LifeOS handles personal productivity data that can become sensitive through content, context or linkage. The repository therefore uses purpose-bound authorization, tenant scope, encryption/secret boundaries, bounded retention and auditable evidence instead of assuming that masking every value is either possible or desirable.

Public repository fixtures are synthetic. Real personal goals, health information, relationship data, credentials, model prompts/responses and production exports must not be committed.

## 2. Data classes

| Class | Examples | Default handling |
| --- | --- | --- |
| Authentication secrets | OAuth client secrets, tokens, signing keys | Secret/KMS boundary; never model/public artifact input. |
| Authentication provenance | user/workspace/session IDs, authentication instant | Identity-owned, bounded, used for authorization/recent-auth decisions. |
| Planning content | goals, projects, tasks, Today drafts | Tenant scoped; durable only after owning-service acceptance. |
| Habit/review content | recurrence, completion/review evidence | Tenant scoped; minimize unnecessary free text in operational evidence. |
| Calendar credentials | access/refresh tokens | Complete hosted encrypted lifecycle is `Partial` under issue #129. |
| AI proposal evidence | proposal IDs/digests/decisions | Inert, auditable, bounded; raw provider text is not retained as public evidence. |
| Privacy access evidence | purpose/grant/decision/audit records | Append-only/immutable where contract requires it. |
| Data-rights request evidence | request IDs, idempotency, digests, status/timestamps | Identity-owned durable ledger; no export payload stored in request receipts. |
| Logs/metrics/traces | operational diagnostics | Bounded, credential-free, avoid unnecessary personal text. |

## 3. Authentication-age lifecycle

**Status:** Implemented on protected main

Authentication time and session issuance time are different facts. Protected main preserves the authentication instant across compatible session rotation and exposes credential-free age evidence for policy checks. Recent-authentication gates fail closed on stale, malformed, future or incompatible provenance.

This prevents session refresh/rotation from being mistaken for a new user authentication ceremony.

## 4. Purpose-bound sensitive access

**Status:** Implemented on protected main

A sensitive-access decision binds at least:

- actor;
- workspace/tenant;
- resource or bounded resource class;
- purpose;
- allowed lifetime/expiry;
- grant/decision identity;
- audit evidence.

A grant cannot be silently reused for another actor, tenant, purpose or resource. Expiry and single-use behavior fail closed where specified.

## 5. Data-rights request lifecycle

### Durable request/receipt foundation

**Status:** Implemented on protected main

The identity service owns durable data-rights request identity and receipt evidence. Protected main provides:

- UUIDv4 request and idempotency identities;
- request kind/status constraints;
- workspace-scoped replay semantics;
- stable domain conflicts for incompatible request-ID/idempotency reuse;
- request and receipt digests;
- request/completion timestamps;
- immutable terminal receipt behavior;
- retention of bounded receipt evidence after source user/workspace erasure where required for reconciliation/audit.

The durable ledger deliberately does not store exported personal payloads.

### Whole-product export/erasure

**Status:** Partial

**Tracking:** issue #55.

The complete lifecycle still requires all of the following to be proven together:

1. explicit registry of every required domain contributor;
2. deterministic export manifests and per-domain digests;
3. recent-authenticated workspace-owner authority at the public boundary;
4. durable request/contributor/reconciliation state across restarts;
5. two-phase or equivalent safe erasure preparation/commit semantics;
6. concrete contributors for identity, planning, habits, reviews, AI audit, calendar and notification data where applicable;
7. bounded retry and operator-visible stuck-request recovery;
8. retention/legal-hold and backup-expiry policy evidence;
9. encrypted/streamed export delivery, expiry and download audit;
10. immutable completion receipt only after every required contributor confirms the final state.

The presence of the durable request ledger is therefore not equivalent to complete data portability/erasure UX.

## 6. Calendar credential lifecycle

**Status:** Partial

**Tracking:** issue #129.

Protected main contains conflict-safe provider adapters but still documents a development/operator-supplied Google token model. Hosted multi-user completion requires:

- trusted LifeOS workspace/user authority;
- explicit calendar-connection identity;
- OAuth state/PKCE/provider-appropriate authorization;
- encrypted access/refresh credential storage through a key-management interface;
- bounded refresh single-flight/retry;
- immediate revocation/disconnect;
- bounded calendar discovery and explicit selection;
- provider account/scope/expiry provenance without using provider IDs as LifeOS primary keys;
- migration away from a process-global development token.

PR #139 is `Implemented on active PR` for the trusted workspace-context prerequisite only.

## 7. Plugin secret lifecycle

**Status:** Planned

**Tracking:** issue #130.

Plugin credentials must be represented by encrypted secret handles, not manifest/log/audit/model plaintext. Installation grants do not inherit capabilities merely because a plugin asks for them. Revocation must prevent future secret use/delivery while preserving bounded audit history.

## 8. AI data lifecycle

**Status:** Implemented on protected main

- model input is bounded to the approved product context;
- model output is untrusted proposal data;
- prompts, raw provider responses and hidden reasoning are not retained in public CI/review artifacts;
- accepted/rejected decisions are explicit auditable product events;
- model credentials never become browser or product-data credentials;
- live provider evidence is separated from deterministic merge correctness.

## 9. Browser-local data

Browser-local drafts/cache/offline state must be explicitly labeled as such. A local draft is not durable until an owning service accepts it. Automatic background migration of pre-existing personal drafts is not implied. PR #127 implements the bounded explicit Today migration/conflict journey on an active PR.

## 10. Backup and erasure

Logical backups can retain data beyond live-record deletion according to operator policy. Product erasure must therefore distinguish:

- live domain deletion;
- immutable/bounded audit evidence legitimately retained;
- backup retention/expiry;
- legal hold where applicable;
- restoration procedures that do not accidentally resurrect data beyond policy without reconciliation.

Current upstream logical backup/restore support does not itself define every operator's retention/legal basis.

## 11. Public diagnostics

Logs, metrics, errors and retained CI artifacts must exclude:

- passwords/tokens/signing keys;
- browser cookies;
- raw exported user payloads;
- unnecessary goal/task/habit free text;
- raw model prompts/responses/hidden reasoning;
- dependency response bodies containing tenant or credential data.

Prefer opaque IDs, bounded classification/status codes, digests, counters, timings and correlation/evidence identifiers.

## 12. Change gate

A change that materially widens collected data, retention, cross-service access, provider credential scope, AI context, export/erasure behavior or audit evidence requires updated tests plus PRD/TRD/threat-model/ADR/data-lifecycle reconciliation before merge.