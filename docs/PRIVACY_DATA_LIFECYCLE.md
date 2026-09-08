# LifeOS Privacy and Data Lifecycle

**Status:** Implemented on active PR

## Control model

LifeOS preserves legitimate product utility while constraining sensitive data through tenant-derived authority, exact actor/resource/purpose/lifetime binding, least privilege, service-owned persistence, explicit secret boundaries, bounded retention, and auditable privileged access. Blanket masking is not the authorization model.

## Data classes and owners

- Identity: accounts, provider mappings, sessions, workspace membership, authentication provenance, and whole-request data-rights evidence.
- Planning: Goals, Projects, Tasks, search, Today, and Planning contributor receipts.
- Habit: recurring definitions/completions and Habit contributor receipts.
- Review: guided-review completion/projection records and protected Review contributor receipts.
- Calendar Integration: connection/sync metadata, active OAuth ceremony state where implemented, and opaque credential/verifier references.
- Notification: reminder occurrences, claims, delivery outcomes, inbox evidence, and active contributor receipts.
- AI Proposal: inert proposals/evidence/decisions and active contributor receipts.
- Privacy: access decisions, bounded grants, and audit events.
- Plugin Integration: installation/grant/credential-binding/delivery-origin/operator replay evidence; active hosted runtime secret material remains Vault-owned.
- Operators: bounded logs/metrics, backup, migration, CI, provenance, signature, and release evidence.

Provider credentials, PKCE verifier plaintext, Vault credentials, browser cookies, private signing keys, raw model prompts/responses, and hidden reasoning are protected secret/transient material. They do not belong in public responses, logs, metrics, model evidence, CI artifacts, or portable exports.

## Lifecycle rules

1. **Collect:** accept only bounded fields required by an owning-service contract.
2. **Authorize:** derive workspace/actor from authenticated or signed context; client ownership fields are untrusted data.
3. **Use:** constrain sensitive access to explicit purpose/resource/lifetime and exact request authority.
4. **Persist:** store only under the owning service's schema/role/migrations; never cross-mutate another service's tables.
5. **Secret handling:** persist only opaque references where external credential material is required; secret plaintext lifetime is bounded to the owning adapter call.
6. **Observe:** logs, metrics, traces, CI, and review evidence remain bounded and credential-free.
7. **Retain:** classify mutable records, immutable audit/receipt evidence, consumed/expired authorization state, legal hold, and backup expiry separately.
8. **Export/Delete:** recent-authenticated whole requests invoke explicit registered service-owned contributors.
9. **Recover:** retries preserve exact idempotency/fencing authority and never fabricate terminal success or restore revoked authority.
10. **Release:** privacy claims bind one exact protected source and deployed artifact/provenance/signature identity.

## Data-rights lifecycle

**Status:** Partial

Protected main includes:

- preserved authentication ceremony time and recent-authentication enforcement;
- durable request identity and immutable terminal aggregate receipt evidence;
- tenant/requesting-user scoped non-cacheable status lookup;
- deterministic per-section and whole-export integrity evidence;
- versioned `life-os.data-rights-contributor.v1` from PR #159;
- Planning contribution from PR #179 and authenticated request-bound transport from PR #194;
- Habit contribution from PR #184 and replay-safe authenticated transport from PR #192;
- Review contribution from PR #195.

Notification contribution in PR #198 and AI contribution in PR #199 are **Implemented on active PR**. Their active branch migrations and receipts remain non-shipped until integration.

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

## Calendar credentials, OAuth state, and connections

**Status:** Partial

Protected main includes signed workspace sync context (PR #139), workspace/user scoped metadata persistence (PR #150), atomic local revocation (PR #153), signed `life-os.calendar-user.v1` authority (PR #155), authenticated disconnect (PR #157), exact returned lookup validation (PR #176), authenticated credential-free read (PR #189), scoped materialization port (PR #193), authenticated secret-first creation (PR #197), returned-evidence compensation (PR #201), and Calendar-owned AES-256-GCM encrypted self-hosted secret storage (PR #203).

Connection rows retain bounded provider/account/calendar metadata and opaque secret references only. Plaintext access/refresh material exists only within the reviewed secret-store/materialization boundary. Local record revocation does not prove provider-side OAuth revocation or secret destruction.

Active #216 rejects deployment-wide Google/CalDAV credentials as hosted user authority. Active #228 adds a bounded OAuth authorization-state lifecycle with opaque UUIDv4 state, exact workspace/user/provider/redirect binding, expiry/one-time consumption, and an opaque PKCE verifier secret reference. PKCE verifier plaintext remains outside durable Calendar metadata, and consumed repository evidence is revalidated before materialization.

Issue #129 remains **Partial** for hosted callback/token exchange, successful post-exchange verifier cleanup, concrete Calendar-owned PostgreSQL OAuth-state runtime, refresh fencing, provider-side revoke/delete recovery, discovery/selection, scoped synchronization composition, complete KMS/runtime rotation and operator recovery. Expired/consumed/revoked ceremony or connection authority cannot be revived by rollback.

## Plugin installation, credentials, delivery origins, and outbound delivery

**Status:** Partial

Protected main separates manifest intent from host authority and includes:

- explicit installation grants from PR #151;
- restart-safe persistence from PR #169;
- opaque secret-reference credential binding and compensation from PR #172;
- exact installation-evidence validation from PR #175;
- one-time request-bound operator authority/replay evidence from PR #191;
- fail-closed operator HTTP composition from PR #196.

Plaintext plugin credentials never belong in manifests, LifeOS persistence, public/application views, logs, metrics, prompts, CI artifacts, or audit rows. Exact replay cannot rematerialize an existing secret. Revocation ends LifeOS authority before external deletion retry and never restores authority.

The active #130 stack preserves those boundaries while adding concrete service-owned runtime pieces: #205 host-owned normalized HTTPS origin identity, #235 Integration-owned PostgreSQL delivery-origin grants and active-installation fencing, #241 credential/revocation consistency hardening, #242 Vault KV v2 secret storage, #243/#244 authenticated Vault and one Integration-owned PostgreSQL pool, #245 concrete hosted/default-entrypoint runtime, and #250 exact signed one-time delivery-origin grant/read/revoke application authority.

Vault holds provider plaintext; durable LifeOS rows keep opaque references only. A stored delivery origin remains bounded identity metadata, not approval for a later DNS/IP, redirect, proxy or rebinding result. #250 does not expose public delivery-origin HTTP transport and does not perform outbound HTTPS.

Issue #130 remains **Partial** until immutable released/versioned canonical egress authority provides connect-time DNS/IP and rebinding enforcement, redirect/proxy/size/time controls, and LifeOS owns delivery attempts/outcomes, bounded retry/dead-letter, delivery-time revocation fencing, operator recovery, migration, rollback and retention semantics.

## First-party browser data lifecycle

**Status:** Partial

Issue #209's active browser/BFF stack starts with #214 and includes durable Goals #229 and Weekly Review #234. Browser memory/local storage is never authoritative tenant or durable-record state. Workspace/actor authority is derived server-side, downstream service requests are signed by trusted BFF code, and returned records are validated before durable acceptance is shown.

The commercial path remains incomplete until all Goals → Projects → Tasks → Habits → Review descendants have current-head E2E for normal/loading/empty/error/permission/conflict/recovery states, stale-response suppression, keyboard/a11y/responsive behavior, Figma/Storybook traceability, authoritative Review projections, and KO/EN/JA/ZH/VI/ES/DE/FR DB-versioned screen-key translation resources. Translation resources remain separate from ontology labels.

## Purpose-bound access

**Status:** Implemented on protected main

Privacy decisions bind exact actor, workspace, resource/resource class, purpose, and lifetime. Grants are bounded, signed/consumable where applicable, and auditable. Access denial and dependency failure remain credential-free. Masking can reduce disclosure but never replaces authorization.

## AI and model-assisted evidence

**Status:** Partial

AI proposals remain inert until explicit authorized decision. Browser credentials and provider secrets are not model inputs. Protected #200 authorizes only the exact reviewed OpenCode bootstrap surface.

Active #208 routes model capability through a released contextual-orchestrator API/client and virtual `orchestrator/free`; provider keys and model selection remain owner-side bootstrap authority. LifeOS does not copy mutable owner source or fall back to direct providers if the gateway cannot authenticate or supply the required capability. Retained model evidence excludes credentials, raw prompts/responses, and hidden reasoning. Model output cannot become product authorization, independent review, merge, or release authority.

## Integrity, secrecy, and provenance

- SHA-256 export/manifest/receipt digests detect deterministic content change but do not provide authorization, confidentiality, signer identity, or non-repudiation.
- Secret references identify least-authority external material; possession of metadata is not permission to materialize a secret.
- Provider/plugin IDs and delivery origins are metadata, not LifeOS primary identity or connect-time network authority.
- CI/SARIF/status evidence identifies the exact inspected source/integration identity; a green umbrella status is not privacy assurance for another tree.
- Release signatures require subject binding, verifiable trust roots and key lifecycle evidence; active #217/#236 verification does not by itself create immutable release authority.
- Backup retention and physical storage expiry remain explicit and cannot be hidden behind immediate logical deletion claims.

## Privacy failure and recovery

Dependency outages return sanitized unavailable evidence. Partial external cleanup retains replayable recovery identity without restoring revoked authority. Ambiguous persistence winners, mismatched durable evidence, malformed rows, and unavailable receipt storage fail closed. Recovery evidence never exposes plaintext secrets or tenant payloads. Consumed OAuth/operator replay evidence and revoked installation/credential/origin authority remain consumed/revoked across retries, restarts and rollback unless a separate audited recovery contract explicitly proves otherwise.
