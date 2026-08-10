# LifeOS Privacy and Data Lifecycle

**Status:** Implemented on active PR

## Control model

LifeOS preserves legitimate product utility while limiting sensitive-data access through tenant-derived authority, explicit purpose/resource/lifetime controls, least privilege, encryption/secret boundaries, bounded retention and auditable privileged access. Blanket masking is not the primary authorization model.

## Data classes

- identity/account and external-provider mappings;
- session/authentication provenance;
- planning, habit and review content;
- calendar connection/synchronization metadata and credential references;
- reminder/delivery evidence;
- AI proposal/evidence/decision records;
- privacy access decisions/grants/events;
- data-rights request/receipt/export-integrity evidence;
- plugin installation/capability evidence;
- operator logs/metrics and release/CI evidence.

Provider credentials, browser cookies, raw model prompts/responses and hidden reasoning are protected secret/transient material and do not belong in public artifacts.

## Lifecycle rules

1. **Collect:** accept only bounded fields required by the owning-service contract.
2. **Authorize:** derive tenant/actor from trusted authenticated or signed context.
3. **Use:** constrain sensitive access to explicit purpose/resource/lifetime.
4. **Persist:** store only in the owning service under service-owned credentials/migrations.
5. **Observe:** logs/metrics use bounded credential-free evidence.
6. **Retain:** retention is explicit by data class; immutable evidence is retained only as required by product/legal/operator policy.
7. **Export/Delete:** recent-authenticated requests use durable rights evidence; complete cross-domain orchestration remains partial.
8. **Backup:** erasure claims account for documented backup expiry rather than imply instantaneous physical disappearance.

## Data-rights lifecycle

**Status:** Partial

Protected main includes authentication-age provenance, fail-closed recent-auth policy, durable requests and immutable terminal receipts, tenant+actor scoped lookup, the authenticated non-cacheable public status resource from PR #146, and per-contributor export integrity evidence from PR #149.

The section/whole SHA-256 evidence is integrity metadata only; it does not prove authorization, confidentiality, provenance or signature identity. Issue #55 remains open for complete contributor participation, durable reconciliation/operator recovery, retention/legal-hold/backup-expiry evidence, protected streamed delivery/encryption/expiry and download audit.

## Calendar credentials and connections

**Status:** Partial

Protected main includes signed workspace context (#139), the workspace+user scoped connection registry (#150), and atomic local connection revocation (#153). Connection rows carry bounded provider/account/calendar metadata and opaque credential references rather than provider-token plaintext. Local revocation ends LifeOS connection authority but does not itself prove provider-side OAuth revocation or managed-secret deletion.

PR #155 is `Implemented on active PR` for a distinct short-lived signed workspace+user context needed by hosted user-sensitive calendar operations. The complete #129 lifecycle still requires OAuth state/PKCE, a concrete managed secret backend, refresh/provider revocation, discovery/selection and public hosted disconnect/runtime composition.

## Plugin installation and secrets

**Status:** Partial

Protected main validates plugin manifests and, through PR #151, separates manifest intent from host-granted installation authority. Explicit capability subsets, exact replay/conflict handling, tenant/user isolation and revocation are protected behavior.

Durable installation/secret persistence, protected secret handles at rest, SSRF-safe outbound delivery, retry/dead-letter evidence and delivery-time revocation enforcement remain issue #130. A granted installation is not evidence that the complete plugin runtime exists.

## Deletion semantics

No service may claim whole-workspace deletion merely because its own tables were erased. Complete deletion requires every registered owning domain to participate in the exact request, deterministic reconciliation of partial/unknown outcomes, retention/legal-hold handling and immutable final evidence. Unknown or missing contributors fail closed.

## Security/privacy invariants

- no browser-selected tenant authority;
- no cross-service direct database access;
- no external credential content in logs, metrics, public errors, model prompts, CI artifacts or generic metadata rows;
- no raw user content in release/provenance artifacts unless explicitly authorized and bounded;
- no whole-right success claim from partial/unknown contributor state;
- no integrity digest is treated as access control or confidentiality;
- no plugin manifest self-authorizes host capabilities;
- no LifeOS connection-record revocation is silently promoted to provider credential revocation.
