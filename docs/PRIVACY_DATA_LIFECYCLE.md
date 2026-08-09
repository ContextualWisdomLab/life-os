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
- data-rights request/receipt evidence;
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
- tenant-scoped request lookup bound simultaneously to request ID, workspace ID and requesting user ID.

Tracking: issue #55 remains open for complete domain participation, durable async reconciliation/operator alerts, retention/legal-hold semantics, backup-expiry evidence, protected streamed archive delivery/encryption/expiry and download audit.

## Calendar credentials

**Status:** Partial

Protected main verifies signed trusted workspace context for calendar synchronization. Hosted per-user encrypted access/refresh credential storage, refresh/revocation, OAuth/PKCE callback lifecycle and calendar selection remain tracked by issue #129.

## Plugin credentials

**Status:** Planned

Issue #130 owns plugin installation grants, encrypted secret handles, SSRF-safe outbound delivery, retry/audit and revocation. Existing plugin validation does not imply runtime secret authority.

## Deletion semantics

No service may claim whole-workspace deletion merely because its own tables were erased. A complete deletion outcome requires every registered owning domain to participate in the exact request, deterministic reconciliation of partial outcomes, retention/legal-hold handling and immutable final evidence. Unknown/missing participants fail closed.

## Security/privacy invariants

- no browser-selected tenant authority;
- no cross-service direct database access;
- no plaintext third-party credential in logs, metrics, public errors, model prompts, CI artifacts or audit rows;
- no raw user content in release/provenance artifacts unless explicitly authorized and bounded;
- no data-rights success claim from a partial or unknown participant state.