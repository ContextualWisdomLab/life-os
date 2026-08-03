# Plugin contract surface slice

## Outcome

Third-party developers can discover and validate a versioned LifeOS plugin contract, construct tenant-scoped interoperable event envelopes, and verify exact delivery bytes without receiving direct database, arbitrary network, command-execution, or secret-storage capability.

## Standards and primary references

- CloudEvents core specification v1.0.2: <https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md>
- CloudEvents JSON event format v1.0.2: <https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md>
- CloudEvents HTTP protocol binding v1.0.2: <https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/http-protocol-binding.md>
- CloudEvents primer and interoperability guidance: <https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/primer.md>
- RFC 9421 HTTP Message Signatures: <https://www.rfc-editor.org/rfc/rfc9421>

CloudEvents defines interoperable event context attributes and requires JSON-format support. The primer recommends a 64 KiB event-size ceiling for broad intermediary compatibility and warns against sensitive context attributes. This slice therefore uses structured JSON CloudEvents 1.0, keeps workspace ownership in a trusted source URI rather than event data, bounds canonical serialized bytes to 64 KiB, and exposes only approved event metadata.

RFC 9421 provides the target interoperable HTTP-message-signature model for a future asymmetric delivery profile. The initial local SDK uses a deliberately narrower HMAC-SHA256 proof over the exact canonical body, delivery UUID, and timestamp. It is not represented as RFC 9421 compliance.

## Included capability

- add a workspace package named `@life-os/plugin-sdk` with strict runtime validators and immutable TypeScript contracts;
- validate reverse-DNS plugin identifiers, contract version, bounded display names, unique explicit event subscriptions, and exact manifest fields;
- reject embedded credentials, workspace identifiers, unknown fields, malformed event types, and duplicate subscriptions;
- create tenant-scoped CloudEvents 1.0 structured JSON envelopes with UUIDv4 identity, RFC 3339 UTC timestamps, fixed LifeOS source URNs, bounded subject URNs, approved schema origin, and JSON-only data;
- recursively canonicalize JSON object keys while rejecting non-finite numbers, deep or oversized structures, prototype-sensitive keys, unsupported values, and payloads above 64 KiB;
- sign and verify exact canonical bytes with HMAC-SHA256, a UUIDv4 delivery identifier, timestamp, constant-time comparison, minimum 256-bit secret material, and bounded replay skew;
- add an integration service with health, contract discovery, manifest validation, and event preparation endpoints;
- derive workspace identity only from `x-workspace-id` and reject ownership fields in event payloads;
- prove through unit and HTTP integration tests that alternate tenants receive distinct source identities and that delivery and command routes do not exist.

## Capability boundary

This slice does not install plugins, persist manifests or subscriptions, store secrets, call third-party endpoints, receive plugin commands, mutate LifeOS data, retry deliveries, maintain dead-letter queues, meter usage, expose a marketplace, or claim RFC 9421 conformance. It adds no database or outbound network dependency to the integration service.

A subsequent slice must add authenticated installation, encrypted per-workspace secret storage, durable subscriptions, explicit least-privilege capability grants, allowlisted HTTPS webhook delivery with DNS and redirect SSRF controls, retries and idempotency, revocation, audit evidence, and operator reconciliation. An interoperable asymmetric signature profile should follow RFC 9421 rather than extending the local HMAC format ad hoc.

## Security properties

- Manifest and event inputs use exact field allowlists.
- Workspace ownership is supplied only by the trusted HTTP header and is embedded into a fixed URN by the service.
- Event schemas are restricted to HTTPS under `schemas.life-os.org/events/`.
- Event identifiers, delivery identifiers, and subject identifiers are opaque UUIDv4 values.
- Canonicalization accepts only bounded JSON values and rejects prototype-sensitive keys.
- Signature verification uses constant-time byte comparison and fails closed on malformed, stale, future, weak-secret, or tampered inputs.
- The service has no `fetch`, socket, database, filesystem, command bus, or mutation dependency.
- Discovery explicitly lists outbound delivery, commands, installation, and secret storage as deferred.

## Validation gate

Merge only when formatting, lint, type checking, SDK unit tests, HTTP integration tests, build, Compose validation, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human/security review feedback pass on the exact current head with no unresolved actionable finding.

## Rollback

The slice is additive and does not persist or transmit plugin data. Roll back by reverting the SDK, integration service, environment-port documentation, and repository documentation. No external plugin registration or delivery state requires migration.

Closes #75. Refs #21.
