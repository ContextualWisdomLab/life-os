# Purpose-bound personal-data access runbook

## Purpose

This runbook operates the LifeOS `privacy-service`. The service authorizes and records access to personal-data categories; it does not proxy, mask, tokenize, copy, or return another service's personal data. After a grant is consumed, the consuming domain service performs its own tenant-scoped read and may return the exact original value required by the authorized business operation.

## Control objective

Original personal data remains usable only when all of the following are true:

- the actor and workspace were authenticated by the trusted service boundary;
- the purpose, action, and resource category match the reviewed policy revision;
- the grant is integrity protected, unexpired, and unused;
- the consuming service atomically consumes the grant immediately before its own read;
- logs, metrics, traces, artifacts, support tools, analytics, and model inputs do not copy the returned value;
- append-only decision and access evidence is retained under the deployment's approved policy.

Masking may be used in demonstrations, development, analytics, or presentation views, but it is not accepted as an authorization control for production business reads.

## Service ownership

- Service: `apps/privacy-service`
- Default port: `4108`
- PostgreSQL schema: `privacy_access`
- Migration owner: privacy-service deployment pipeline
- Health route: `GET /v1/privacy/health`
- Decision route: `POST /v1/privacy/access-decisions`
- Consumption route: `POST /v1/privacy/access-grants/consume`

The privacy service must not receive direct public ingress. Only an authenticated gateway or an explicitly authorized internal workload may sign the private context headers.

## Required protected configuration

```text
PRIVACY_DATABASE_URL
PRIVACY_GRANT_ACTIVE_KEY_ID
PRIVACY_GRANT_ACTIVE_KEY_SECRET
PRIVACY_CONTEXT_ACTIVE_KEY_ID
PRIVACY_CONTEXT_ACTIVE_KEY_SECRET
PRIVACY_AUDIT_DIGEST_KEY
```

Optional bounded overlap configuration:

```text
PRIVACY_GRANT_PREVIOUS_KEY_ID
PRIVACY_GRANT_PREVIOUS_KEY_SECRET
PRIVACY_CONTEXT_PREVIOUS_KEY_ID
PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET
```

Operational pool settings:

```text
PRIVACY_DATABASE_POOL_MAX
PRIVACY_DATABASE_CONNECT_TIMEOUT_MS
PRIVACY_DATABASE_IDLE_TIMEOUT_MS
PRIVACY_SERVICE_PORT
```

Grant signing, private-context signing, and audit digesting require independent secret material. Do not reuse a secret across purposes. Store all secrets in the deployment's approved KMS or secret manager; do not place them in images, manifests, issue text, logs, or retained workflow artifacts.

## Request flow

1. Authenticate the session or workload.
2. Resolve exact UUIDv4 workspace and actor identifiers.
3. Authorize workspace membership before contacting privacy-service.
4. Sign the exact HTTP method and `/v1/...` path with a short-lived private context.
5. Request the narrow purpose/action/resource-category combination.
6. On an allowed decision, hold the returned grant token only in request memory.
7. Submit it once to the consume route immediately before the service-local PII read.
8. Use the returned receipt to authorize only the requested operation and category.
9. Return the exact original value only to the authenticated caller.
10. Drop the grant token; never persist or log it.

A decision receipt does not authorize a read. Only a successful grant-consumption receipt does.

## Ordinary access

The initial policy permits:

- workspace operation: read/correct for planning, habit, review, calendar, and notification content;
- account support: identity-profile read with a reason;
- security investigation: identity, notification, and AI-audit read with a reason;
- data-subject request: read/export registered categories with a reason;
- legal obligation: read/export registered categories with a reason.

Ordinary grants expire after at most 15 minutes. Consumers should request the shortest practical TTL and consume immediately.

## Break-glass access

The initial break-glass policy is read-only, requires a normalized bounded reason, and expires after at most five minutes. Break-glass must be restricted to approved incident responders and must trigger an operator review outside the service.

Minimum review evidence:

- decision and access-event UUIDs;
- correlation UUID;
- approved incident identifier stored outside privacy-service;
- actor/workspace verification evidence;
- purpose and resource category;
- access time and reviewer;
- conclusion and remediation.

Do not copy the accessed personal value into the review ticket. Later releases should require dual control and immediate alerting.

## Key rotation

### Grant keys

1. Generate a new active identifier and independently generated secret.
2. Deploy privacy-service with the new key as active and the former active pair as previous.
3. Deploy every trusted issuer/consumer configuration that relies on the active identifier.
4. Wait at least the maximum grant TTL plus deployment overlap.
5. Remove the previous pair.
6. Verify retired-key tokens fail immediately.

### Context keys

Follow the same expand/switch/contract process, waiting at least the 60-second context validity plus deployment overlap before removing the previous pair.

### Suspected compromise

Do not use a normal overlap. Remove the compromised key immediately, stop affected traffic, rotate dependent secrets, inspect append-only evidence, and follow the incident-response plan. Key identifiers are not secrets; secret values are.

## Audit and retention

The database stores:

- allow/deny decision metadata;
- grant-token digest, not token text;
- policy revision and digest;
- keyed reason digest;
- keyed resource-reference digest;
- consumption event metadata.

It does not store reasons, personal values, prompts, cookies, bearer tokens, signatures, grant tokens, or resource identifiers in clear text.

Append-only database triggers prevent ordinary update/delete of decisions and events. This is not off-system immutability. Replicate approved evidence to independently protected storage according to legal, privacy, SOC 2, ISMS-P, and CSAP retention requirements.

## Monitoring

Allowed low-cardinality metrics:

- operation: `decide`, `consume`;
- outcome: `allowed`, `denied`, `invalid`, `dependency_failure`;
- mode: `ordinary`, `break_glass`;
- resource category.

Forbidden labels and log attributes:

- actor/workspace/grant/decision/event identifiers;
- purpose reason;
- resource reference;
- personal values;
- token, signature, or key material.

Alert on dependency failures, unusual deny ratios, any break-glass event, repeated replay attempts, and sustained policy-validation failures. Investigation must use protected append-only evidence rather than adding high-cardinality telemetry.

## Failure handling

- `400 invalid_request`: reject; correct the bounded body and do not retry blindly.
- `401 authentication_required`: private context is absent, forged, stale, future-dated, or path/method mismatched; re-authenticate and reauthorize.
- `403 access_denied`: policy deliberately denied the combination; use the opaque decision receipt for protected review.
- `503 privacy_service_unavailable`: do not read original personal data. Retry with bounded backoff after database/service health is restored.

There is no fail-open mode. Consumers must not bypass privacy-service, reuse a consumed grant, extend a token locally, or substitute masking for authorization.

## Backup and recovery

Include the `privacy_access` schema in encrypted PostgreSQL backups. Restore tests must prove:

- append-only evidence row counts and digests survive;
- unused grants remain verifiable only while their keys and validity windows remain active;
- consumed grants remain consumed;
- event/decision foreign-key relationships remain valid;
- no raw PII appears in the restored schema.

Restoring evidence to a non-production environment requires the same access controls because actor/workspace metadata remains sensitive even without raw PII.

## SOC 2, CSAP, ISMS-P, and PIPA evidence

This service contributes technical evidence for logical access, least privilege, emergency access classification, cryptography, audit generation/protection, privacy purpose limitation, and restricted data use. Certification additionally requires approved organizational policies, control owners, key custody, workforce access reviews, vendor/subprocessor governance, incident response, change management, vulnerability management, backup/recovery, regional/cloud architecture, and an operating history.

See `docs/research/2026-08-07-purpose-bound-pii-access-standards.md` for the current standards mapping, limitations, and APA 7 references.
