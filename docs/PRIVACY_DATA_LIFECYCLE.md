# LifeOS Privacy and Data Lifecycle

**Status:** Implemented on active PR

## Control model

LifeOS preserves legitimate product utility while constraining sensitive data through tenant-derived authority, exact actor/resource/purpose/lifetime binding, least privilege, service-owned persistence, explicit secret boundaries, bounded retention, and auditable privileged access. Blanket masking is not the authorization model.

## Data classes and owners

- Identity: accounts, provider mappings, sessions, workspace membership, authentication provenance, and whole-request data-rights evidence.
- Planning: Goals, Projects, Tasks, search, Today, and Planning contributor receipts.
- Habit: recurring definitions/completions and Habit contributor receipts.
- Review: guided-review completion/projection records.
- Calendar Integration: connection/sync metadata and opaque credential references.
- Notification: reminder occurrences, claims, delivery outcomes, and inbox evidence.
- AI Proposal: inert proposals/evidence/decisions.
- Privacy: access decisions, bounded grants, and audit events.
- Plugin Integration: installation/grant/credential-binding/operator replay evidence.
- Operators: bounded logs/metrics, backup, migration, CI, provenance, and release evidence.

Provider credentials, browser cookies, private signing keys, raw model prompts/responses, and hidden reasoning are protected secret/transient material. They do not belong in public responses, logs, metrics, model evidence, CI artifacts, or portable exports.

## Lifecycle rules

1. **Collect:** accept only bounded fields required by an owning-service contract.
2. **Authorize:** derive workspace/actor from authenticated or signed context; client ownership fields are untrusted data.
3. **Use:** constrain sensitive access to explicit purpose/resource/lifetime and exact request authority.
4. **Persist:** store only under the owning service's schema/role/migrations; never cross-mutate another service's tables.
5. **Secret handling:** persist only opaque references where external credential material is required.
6. **Observe:** logs, metrics, traces, CI, and review evidence remain bounded and credential-free.
7. **Retain:** classify mutable records, immutable audit/receipt evidence, legal hold, and backup expiry separately.
8. **Export/Delete:** recent-authenticated whole requests invoke explicit registered service-owned contributors.
9. **Recover:** retries preserve exact idempotency/fencing authority and never fabricate terminal success.
10. **Release:** privacy claims bind one exact protected source and deployed artifact/provenance identity.

## Data-rights lifecycle

**Status:** Partial

Protected main includes:

- preserved authentication ceremony time and recent-authentication enforcement;
- durable request identity and immutable terminal aggregate receipt evidence;
- tenant/requesting-user scoped non-cacheable status lookup;
- deterministic per-section and whole-export integrity evidence;
- versioned `life-os.data-rights-contributor.v1` from PR #159;
- Planning contribution from PR #179 and authenticated request-bound transport from PR #194;
- Habit contribution from PR #184 and replay-safe authenticated transport from PR #192.

Review contribution in PR #195 is **Implemented on active PR**. Notification contribution in PR #198 is **Implemented on active PR**. AI contribution in PR #199 is **Implemented on active PR**. Active branch migrations and receipts remain non-shipped until integration.

Issue #55 remains **Partial** because required Identity-owned erasure, Calendar, Privacy, Plugin Integration, remaining service inventory, durable asynchronous reconciliation, operator recovery, retention/legal hold, backup expiry, protected streamed/encrypted export delivery, expiry/deletion/download audit, and exact terminal participant-set completion are not all protected.

### Deletion semantics

No service may claim whole-workspace deletion because its own records were erased. Complete deletion requires:

- an exact immutable request and explicit required-participant inventory;
- successful preflight for every participant;
- owner-controlled replay-safe erasure in safe order;
- post-erasure verification by every owner;
- deterministic reconciliation of partial, unavailable, and unknown outcomes;
- retention/legal-hold and backup-expiry evidence;
- one final immutable whole-product receipt only after all required evidence is reconciled.

Unknown or missing participants fail closed. Identity orchestration never receives another service's SQL credentials.

## Calendar credentials and connections

**Status:** Partial

Protected main includes signed workspace sync context (PR #139), workspace/user scoped metadata persistence (PR #150), atomic local revocation (PR #153), signed `life-os.calendar-user.v1` authority (PR #155), authenticated disconnect (PR #157), exact returned lookup validation (PR #176), authenticated credential-free read (PR #189), scoped materialization port (PR #193), and authenticated secret-first creation (PR #197).

Connection rows retain bounded provider/account/calendar metadata and opaque secret references only. Plaintext access/refresh material exists only within the reviewed secret-store/materialization call boundary. Local record revocation does not prove provider-side OAuth revocation or secret destruction.

PR #201 protects compensation of newly written secret handles when durable create evidence mismatches exact connection/workspace/user/handle authority.

Issue #129 remains **Partial** for concrete encrypted KMS/secret storage, OAuth state/PKCE/callback, refresh fencing, provider-side revoke/delete recovery, discovery/selection, scoped synchronization composition, migration from process-global credentials, rotation, and operator recovery.

## Plugin installation, credentials, and outbound delivery

**Status:** Partial

Protected main separates manifest intent from host authority and includes:

- explicit installation grants from PR #151;
- restart-safe persistence from PR #169;
- opaque secret-reference credential binding and compensation from PR #172;
- exact installation-evidence validation from PR #175;
- one-time request-bound operator authority/replay evidence from PR #191;
- fail-closed operator HTTP composition from PR #196.

Plaintext plugin credentials never belong in manifests, LifeOS persistence, public/application views, logs, metrics, prompts, CI artifacts, or audit rows. Exact replay cannot rematerialize an existing secret. Revocation ends LifeOS authority before external deletion retry and never restores authority.

Issue #130 remains **Partial** for a concrete KMS adapter, separately host-authorized delivery origins, DNS/IP/SSRF/rebinding-safe HTTPS, redirect/proxy/size/time controls, per-plugin signing/rotation, delivery attempt/outcome persistence, bounded retry/dead-letter, delivery-time revocation fencing, and operator-visible recovery.

## Purpose-bound access

**Status:** Implemented on protected main

Privacy decisions bind exact actor, workspace, resource/resource class, purpose, and lifetime. Grants are bounded, signed/consumable where applicable, and auditable. Access denial and dependency failure remain credential-free. Masking can reduce disclosure but never replaces authorization.

## AI and model-assisted evidence

**Status:** Accepted architecture

AI proposals remain inert until explicit authorized decision. Browser credentials and provider secrets are not model inputs. `NVIDIA_NIM_API_KEY` may materialize only inside the reviewed model-call/development boundary. Retained model evidence excludes the key, raw prompts/responses, and hidden reasoning.

Model output cannot become product authorization, independent review, merge, or release authority. PR #200 is **Implemented on protected main** only for restoring the pinned OpenCode executable through a narrow lifecycle-script allowlist; it does not broaden model or repository authority.

## Integrity, secrecy, and provenance

- SHA-256 export/manifest/receipt digests detect deterministic content change but do not provide authorization, confidentiality, signer identity, or non-repudiation.
- Secret references identify least-authority external material; possession of metadata is not permission to materialize a secret.
- Provider/plugin IDs are metadata, not LifeOS primary identity.
- CI/SARIF/status evidence must identify the exact inspected source/integration identity; a green umbrella status is not privacy assurance for another tree.
- Backup retention and physical storage expiry remain explicit and cannot be hidden behind immediate logical deletion claims.

## Privacy failure and recovery

Dependency outages return sanitized unavailable evidence. Partial external cleanup retains replayable recovery identity without restoring revoked authority. Ambiguous persistence winners, mismatched durable evidence, malformed rows, and unavailable receipt storage fail closed. Recovery evidence never exposes plaintext secrets or tenant payloads.
