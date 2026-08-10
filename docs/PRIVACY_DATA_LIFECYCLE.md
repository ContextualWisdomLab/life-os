# LifeOS Privacy and Data Lifecycle

**Status:** Implemented on active PR

## Control model

LifeOS preserves business utility while limiting sensitive-data access through tenant-derived authority, explicit purpose/resource/lifetime controls, least privilege, encryption/secret boundaries, retention and auditable privileged access. Blanket PII masking is not the product's primary control.

## Data classes

- identity/account and external-provider mapping;
- session/authentication provenance;
- planning, habit and review content;
- calendar connection/synchronization metadata;
- reminder/delivery evidence;
- AI proposal/evidence/decision records;
- privacy access decisions/grants/events;
- data-rights request/receipt/export-integrity evidence;
- operator logs/metrics and release/CI evidence.

Provider credentials, browser cookies, raw model prompts/responses and hidden reasoning are protected secret/transient material and do not belong in public artifacts.

## Lifecycle rules

1. **Collect:** accept only bounded fields required by the owning service contract.
2. **Authorize:** derive workspace/actor from trusted authenticated/signed context.
3. **Use:** constrain sensitive access to explicit resource/purpose/lifetime.
4. **Persist:** store only in the owning service with service-owned credentials/migrations.
5. **Observe:** logs/metrics expose bounded credential-free operational evidence.
6. **Retain:** retention is explicit by data class; immutable evidence is retained only as required by product/legal/operator policy.
7. **Export/Delete:** recent-authenticated workspace owner requests are tracked through durable request evidence; complete domain orchestration remains partial.
8. **Backup:** backups follow the same sensitivity/tenant/operator controls and erasure claims must account for documented backup expiry rather than imply instantaneous physical disappearance.

## Current protected-main data-rights evidence

**Status:** Partial

Protected main includes:

- authentication-age provenance that survives session rotation;
- fail-closed recent-auth policy;
- authenticated workspace/requesting-user binding;
- durable data-rights request and immutable terminal receipt persistence;
- tenant-scoped request lookup bound simultaneously to request ID, workspace ID and requesting user ID;
- an authenticated public status resource from PR #146 that derives scope from the server session, returns a bounded non-cacheable lifecycle projection, and makes absent/cross-tenant requests indistinguishable;
- per-contributor export integrity evidence from PR #149 using safe business record counts, deterministic section SHA-256 and a whole-export digest.

The PR #149 digest contract is integrity evidence only. It does not prove authorization, confidentiality, provenance or signature identity and does not complete protected export delivery.

Tracking: issue #55 remains open for complete domain participation, durable async reconciliation/operator alerts, retention/legal-hold semantics, backup-expiry evidence, protected streamed archive delivery/encryption/expiry and download audit.

## Calendar credentials

**Status:** Partial

Protected main verifies signed trusted workspace context for calendar synchronization. PR #150 is `Implemented on active PR` for the first durable calendar-connection registry scoped simultaneously to workspace and user. The active repository stores bounded provider/account/calendar metadata, normalized scopes and opaque credential references rather than making provider credential content part of the row contract.

The complete hosted lifecycle still requires authorization callback state/PKCE, a concrete managed secret backend, refresh/revocation, calendar discovery/selection and migration from the development provider configuration under issue #129.

## Plugin credentials and installation authority

**Status:** Partial

Protected main validates plugin manifests/contracts but grants no generic runtime authority. PR #151 is `Implemented on active PR` for the first host-owned installation authority: the manifest is intent, the host grants an explicit capability subset, replay/conflict is deterministic, cross-tenant/user lookup does not disclose existence, and revocation preserves evidence while ending active authority.

Durable installation persistence, protected plugin secret storage, SSRF-safe outbound delivery, retry/dead-letter evidence and complete revocation enforcement remain issue #130. An active installation-grant object is therefore not evidence that the complete plugin runtime exists.

## Deletion semantics

No service may claim whole-workspace deletion merely because its own tables were erased. A complete deletion outcome requires every registered owning domain to participate in the exact request, deterministic reconciliation of partial outcomes, retention/legal-hold handling and immutable final evidence. Unknown/missing participants fail closed.

## Security/privacy invariants

- no browser-selected tenant authority;
- no cross-service direct database access;
- no provider credential content in logs, metrics, public errors, model prompts, CI artifacts or audit rows;
- no raw user content in release/provenance artifacts unless explicitly authorized and bounded;
- no data-rights success claim from a partial or unknown participant state;
- no integrity digest is treated as an authorization or confidentiality control.
