# Purpose-bound PII access governance design

**Date:** 2026-08-07  
**Status:** Approved for implementation  
**Tracking issue:** #118  
**Capability:** `privacy.purpose-bound-access`

## Product outcome

LifeOS keeps identity-bearing personal data usable for authorized work without making masking the authorization boundary. A consuming service requests a narrowly scoped grant, receives a signed opaque authorization token when policy allows, atomically consumes that grant once, and then returns the original business payload through its own existing data contract. The privacy service retains only bounded decision metadata and cryptographic digests.

## Scope

This slice adds:

- an independently deployable `privacy-service`;
- a reusable purpose/action/resource policy contract;
- signed, short-lived, single-use grants;
- ordinary and break-glass access modes;
- append-only PostgreSQL decision and consumption evidence;
- a versioned HTTP API for decision and consumption;
- realistic integration evidence proving exact unmasked Unicode values survive an authorized service-local read;
- standards, SOC 2, CSAP, ISMS-P, and Korean PIPA control mapping.

This slice does not add a generic cross-service PII proxy, dynamic table discovery, raw PII audit storage, automatic legal-basis determination, consent management, dual-control approval, anomaly detection, or production key-manager integration.

## Architectural boundary

```mermaid
sequenceDiagram
    participant User
    participant Consumer as Domain service / BFF
    participant Identity
    participant Privacy as Privacy service
    participant Domain as Service-owned data source
    participant Audit as privacy_access evidence

    User->>Consumer: Business operation
    Consumer->>Identity: Authenticate actor and workspace
    Identity-->>Consumer: Actor UUIDv4 + workspace UUIDv4
    Consumer->>Privacy: Signed context + purpose/action/resource category
    Privacy->>Audit: Append allow/deny decision metadata
    Privacy-->>Consumer: Short-lived opaque single-use grant
    Consumer->>Privacy: Consume exact grant
    Privacy->>Audit: Atomically mark consumed + append access event
    Privacy-->>Consumer: Verified bounded access context
    Consumer->>Domain: Existing tenant-scoped read
    Domain-->>Consumer: Original authorized payload
    Consumer-->>User: Original value; no masking
```

The privacy service never fetches another service's rows and never becomes a universal PII aggregation point. The consumer remains responsible for its existing tenant-scoped query and response contract. The consumed grant is evidence that the requested purpose, action, and resource category were authorized for one bounded operation.

## Trust boundaries

### Trusted inputs

Only a private gateway or service-to-service boundary may set:

- workspace UUIDv4;
- actor UUIDv4;
- method and path;
- signed context key identifier, issuance time, and signature.

JSON bodies cannot override ownership. The privacy-service signing secret, grant-token key ring, browser cookies, OAuth tokens, and provider credentials are server-only.

### Untrusted inputs

The following remain untrusted until validated:

- purpose, action, resource category, requested validity, and reason;
- signed context headers;
- access grant tokens;
- PostgreSQL rows and timestamps;
- service-local payloads used only to compute a digest in integration tests;
- environment variables and key configuration.

## Policy model

### Purposes

Initial ordinary purposes:

- `workspace_operation`
- `account_support`
- `security_investigation`
- `data_subject_request`
- `legal_obligation`

Separate emergency purpose:

- `break_glass`

### Actions

- `read`
- `export`
- `correct`
- `administer`

### Resource categories

- `identity_profile`
- `planning_content`
- `habit_content`
- `review_content`
- `calendar_content`
- `notification_content`
- `ai_audit_content`

### Access modes

- `ordinary`: maximum 15 minutes; reason optional for workspace operation and required for privileged purposes;
- `break_glass`: maximum 5 minutes; reason required; read-only in the initial slice; separately identified in every decision and event.

### Initial policy matrix

The policy is code-reviewed, immutable, versioned by a UUIDv4 revision, and represented by a canonical SHA-256 digest. It is deliberately narrow:

- `workspace_operation` permits `read` and `correct` for planning, habit, review, calendar, and notification categories;
- `account_support` permits `read` for identity profile only with a reason;
- `security_investigation` permits `read` for identity profile, notification, and AI audit categories with a reason;
- `data_subject_request` permits `read` and `export` across registered categories with a reason;
- `legal_obligation` permits `read` and `export` across registered categories with a reason;
- `break_glass` permits `read` across registered categories with a reason and the shorter TTL.

Unknown combinations fail closed. The implementation does not infer legal basis from the purpose label.

## Grant lifecycle

1. A decision request is normalized and canonically serialized.
2. The policy engine produces `allowed` or `denied` without loading personal data.
3. Every outcome receives an opaque UUIDv4 `decision_id` and an append-only decision record.
4. An allowed outcome additionally receives a UUIDv4 `grant_id`, exact issuance/expiry instants, policy revision/digest, and HMAC-SHA-256 compact token.
5. A consumer submits the token to the consume endpoint immediately before its service-local read.
6. The repository locks the grant row, verifies unused and unexpired state, verifies the signed claims and trusted actor/workspace context, marks it consumed, and appends one access event in one transaction.
7. Replays, stale policy revisions, cross-tenant contexts, actor mismatch, altered claims, and expired tokens fail closed.

The access event stores category, purpose, action, decision/grant identifiers, policy evidence, and an optional canonical resource-reference digest. It never stores the accessed value.

## Token contract

Schema identifier:

```text
life-os.privacy-access-grant.v1
```

Compact representation:

```text
base64url(canonical-json-claims).base64url(hmac-sha256)
```

Claims:

- `schema`
- `keyId`
- `grantId`
- `decisionId`
- `workspaceId`
- `actorId`
- `purpose`
- `action`
- `resourceCategory`
- `accessMode`
- `policyRevisionId`
- `policyDigest`
- `issuedAt`
- `expiresAt`

The verifier selects one exact active or previous key by case-sensitive key identifier and never trials every secret. Active and previous identifiers and secrets must be distinct. Expiry is always checked against an injected clock. Tokens are single-use because repository consumption is atomic.

## Database design

Dedicated schema:

```text
privacy_access
```

Tables:

- `privacy_access.privacy_access_decisions`
- `privacy_access.privacy_access_grants`
- `privacy_access.privacy_access_events`

All identifiers are UUIDv4. All object names contain at least two words and use `snake_case`. Tables are tenant-scoped and indexed by workspace plus bounded time/order fields. Update and delete triggers reject mutation of decision and event evidence. Grant rows permit one narrowly defined transition from unused to consumed; other mutation is rejected.

No raw reason is persisted. A reason is normalized and reduced to a keyed SHA-256 digest. Resource references and payload evidence use keyed digests to reduce equality and low-entropy guessing risk. Deployment key separation is required between context signing, grant signing, and audit digesting.

## HTTP surface

- `GET /health`
- `POST /v1/privacy/access-decisions`
- `POST /v1/privacy/access-grants/consume`

Decision body accepts only:

- `purpose`
- `action`
- `resourceCategory`
- `requestedTtlSeconds`
- optional `reason`

Consume body accepts only:

- `grantToken`
- optional `resourceReference`

Workspace and actor never appear in request bodies. Responses use bounded JSON or RFC 9457 problem details and never echo rejected credentials, signatures, reasons, tokens, or PII.

## PII handling rule

The privacy service is an authorization and evidence service. It does not transform business values. The consumer performs its normal tenant-scoped read after successful consumption and may return the exact original value. An integration fixture containing Korean names, Unicode addresses, and contact data proves byte-for-byte value preservation through the authorized path while also proving those values are absent from audit records, logs, tokens, and problems.

## Availability and failure behavior

- Policy denial is a normal bounded `403` outcome with a persisted decision.
- Invalid or forged context/token is a credential-free `401` or `400` failure and does not expose why a secret comparison failed.
- Repository failure returns `503` and never claims a grant was consumed.
- Concurrent consumption permits exactly one success.
- Expired tokens remain unconsumed and cannot be revived.
- Break-glass decisions are distinguishable in metrics and receipts but metrics contain no actor or workspace labels.

## Observability

Allowed low-cardinality labels:

- operation (`decide`, `consume`)
- outcome (`allowed`, `denied`, `invalid`, `dependency_failure`)
- access mode (`ordinary`, `break_glass`)
- resource category

Actor IDs, workspace IDs, grant IDs, decision IDs, reasons, resource references, and PII are forbidden metric labels. Structured logs contain a correlation UUIDv4 and stable failure class only. Detailed access evidence belongs in the protected database records.

## CSAP and SOC 2 considerations

The service supplies technical evidence for logical access, least privilege, cryptography, audit generation/protection, change control, restricted data use, privacy purpose limitation, and emergency access classification. Production certification additionally requires organizational policy, control owners, key custody, privileged-access review, independent audit retention, incident response, vulnerability management, backup/recovery, cloud-region and outsourcing decisions, and operating-period evidence.

## Test strategy

### Domain and cryptographic tests

- complete policy matrix and fail-closed combinations;
- TTL, reason, UUIDv4, Unicode, control-character, and byte bounds;
- deterministic policy digest and canonical token claims;
- active/previous key rotation and retired/unknown key rejection;
- forged, truncated, malformed, future-dated, expired, cross-tenant, cross-actor, and stale-policy tokens;
- constant-time signature comparison path;
- no secret or rejected input in error strings.

### PostgreSQL integration tests

- append-only decisions and events;
- exactly-one concurrent grant consumption;
- rollback when event append fails;
- tenant isolation;
- no raw reason, resource reference, or PII in stored rows;
- correct timestamp and UUIDv4 round-trip;
- forbidden update/delete;
- restart-safe unused grant and replay refusal.

### Realistic business test

A synthetic identity profile contains an exact Korean name, mixed-script postal address, phone number, and email. An allowed service-local read returns the exact original object after grant consumption. A denied purpose, another workspace, replay, and expired grant return no profile. Serialized decisions, events, problems, metrics, and tokens are asserted not to contain any profile value.

## Deferred work

- dual-control break-glass approval and alert delivery;
- asymmetric workload identity and hardware-backed keys;
- external immutable evidence anchoring;
- field-level data classification and per-field purpose policies;
- consent/legal-basis registry and records of processing;
- anomaly detection and access review UI;
- production KMS/HSM integration and automatic rotation;
- streamed export integration and deletion/retention orchestration;
- policy administration UI and Korean/English operator localization.

## References

See `docs/research/2026-08-07-purpose-bound-pii-access-standards.md` for the current standards mapping, limitations, and APA 7 references.
