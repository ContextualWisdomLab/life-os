# Purpose-bound PII access governance implementation plan

> **For agentic workers:** Use test-driven development for each task, verify the exact changed package before committing, and remove temporary write-capable workflows before merge.

**Goal:** Deliver an independently deployable privacy authorization and audit service that preserves original authorized personal data while enforcing tenant, purpose, action, resource, time, single-use, and evidence boundaries.

**Architecture:** `privacy-service` owns a policy engine, compact signed grant contract, PostgreSQL decision/grant/event repository, and NestJS HTTP boundary. Consuming services call decision and consume endpoints but retain ownership of their original PII stores. The privacy service stores only metadata and keyed digests.

**Tech stack:** TypeScript 5.9, Node.js 22, NestJS 11, PostgreSQL 16+, Vitest/V8 coverage, HMAC-SHA-256, RFC 9457 problem details, Docker Compose, GitHub Actions.

## Global constraints

- No production masking of authorized values.
- No raw PII, reason, resource reference, browser credential, signing secret, or grant token in logs, metrics, audit rows, errors, or retained artifacts.
- Workspace and actor come only from a trusted signed context boundary.
- Internal identifiers are UUIDv4 strings.
- Database objects use multiword `snake_case` names in the `privacy_access` schema.
- SQL is static and parameterized.
- Grants are short-lived and single-use.
- Break-glass is explicit, read-only, shorter-lived, and reason-bound.
- Every production declaration has explanatory JSDoc.
- New production code has 100% statement, branch, function, and line coverage.
- Standards and research claims are documented with APA 7 references.

---

## Task 1: Define the policy domain with failing tests

**Files:**

- Create: `apps/privacy-service/src/privacy-access-domain.test.ts`
- Create: `apps/privacy-service/src/privacy-access-domain.ts`

**RED evidence:**

- encode the complete ordinary and break-glass policy matrix;
- reject unknown purpose/action/category, malformed UUIDv4, invalid TTL, controls, and oversized UTF-8 input;
- require reasons for support, investigation, data-subject, legal, and break-glass purposes;
- enforce 15-minute ordinary and 5-minute break-glass caps;
- prove deterministic policy revision and canonical request digest;
- prove errors never interpolate rejected inputs.

**GREEN implementation:**

- immutable enums and policy table;
- `evaluatePrivacyAccessRequest`;
- canonical serialization and SHA-256 policy/request digests;
- injectable UUID and clock seams;
- explicit allowed/denied decision value objects.

**Verification:**

```bash
pnpm --filter @life-os/privacy-service exec vitest run src/privacy-access-domain.test.ts --no-file-parallelism
```

## Task 2: Implement key rings and signed single-use grant tokens

**Files:**

- Create: `apps/privacy-service/src/privacy-access-token.test.ts`
- Create: `apps/privacy-service/src/privacy-access-token.ts`

**RED evidence:**

- active-key signing and exact active/previous verification;
- unknown, retired, duplicate, incomplete, malformed, short, control-bearing, and oversized key configuration;
- canonical compact token generation;
- forged body/signature, invalid base64url, extra/missing claims, cross-actor/workspace, future issuance, expiry, and stale policy rejection;
- constant-time signature comparison path;
- no secret, token, or rejected claim in errors.

**GREEN implementation:**

- immutable key-ring parser;
- versioned canonical claims;
- HMAC-SHA-256 signer and verifier;
- exact key-id selection with no trial verification;
- bounded clock skew and TTL validation.

## Task 3: Create append-only PostgreSQL schema and repository contract

**Files:**

- Create: `apps/privacy-service/migrations/0001_purpose_bound_privacy_access.sql`
- Create: `apps/privacy-service/src/postgres-privacy-access-repository.test.ts`
- Create: `apps/privacy-service/src/postgres-privacy-access-repository.ts`
- Create: `apps/privacy-service/src/privacy-access-repository.ts`
- Create: `apps/privacy-service/src/privacy-access-migration.test.ts`

**RED evidence:**

- every SQL value is bound;
- tenant and actor are part of every lookup and transition;
- denied and allowed decisions are appended;
- allowed grants are persisted with token digest, never token text;
- consume uses row locking and exact unused/unexpired/policy conditions;
- decision/event update and delete are rejected;
- grant transition permits only unused → consumed;
- malformed and cross-tenant rows fail closed;
- reason and resource-reference input appear only as keyed digests.

**GREEN implementation:**

- `privacy_access.privacy_access_decisions`;
- `privacy_access.privacy_access_grants`;
- `privacy_access.privacy_access_events`;
- multiword indexes, checks, constraints, and mutation-rejection triggers;
- transaction-scoped atomic consumption and event append.

## Task 4: Compose the application service

**Files:**

- Create: `apps/privacy-service/src/privacy-access-application.test.ts`
- Create: `apps/privacy-service/src/privacy-access-application.ts`

**RED evidence:**

- persist every allow/deny decision;
- issue a token only after allowed decision persistence;
- consume only an exact valid grant;
- replay and concurrency return one success;
- repository failure never returns an allowed or consumed claim;
- keyed digest evidence excludes raw reason/resource reference;
- realistic authorized profile read returns exact original Unicode PII through a service-local adapter and every denied path returns no profile.

**GREEN implementation:**

- `PrivacyAccessApplication.decide`;
- `PrivacyAccessApplication.consume`;
- narrow `AuthorizedPersonalDataReader<T>` composition helper for tests and consuming services;
- sanitized stable application errors.

## Task 5: Add production runtime and HTTP boundary

**Files:**

- Create: `apps/privacy-service/src/privacy-access-http-boundary.test.ts`
- Create: `apps/privacy-service/src/privacy-access-http-boundary.ts`
- Create: `apps/privacy-service/src/privacy-runtime.test.ts`
- Create: `apps/privacy-service/src/privacy-runtime.ts`
- Create: `apps/privacy-service/src/main.test.ts`
- Create: `apps/privacy-service/src/main.ts`
- Create: `apps/privacy-service/src/server.test.ts`
- Create: `apps/privacy-service/src/server.ts`

**RED evidence:**

- signed trusted context only; no ownership injection in body/query;
- exact request key sets and bounded bodies;
- RFC 9457 credential-free failures;
- no token/reason/signature echo;
- health endpoint requires no database content;
- pool configuration, error listener, and exactly-once concurrent shutdown;
- `GET /health`, decision POST, and consume POST only;
- no generic PII proxy or listing endpoint.

**GREEN implementation:**

- NestJS composition root;
- dedicated PostgreSQL pool;
- active/previous context and grant keys;
- keyed audit digest secret;
- bounded correlation IDs and low-cardinality metrics.

## Task 6: Add real PostgreSQL and realistic business integration evidence

**Files:**

- Create: `apps/privacy-service/src/postgres-privacy-access-repository.integration.test.ts`
- Create: `apps/privacy-service/src/privacy-access-business.integration.test.ts`

**Scenarios:**

- migrate a disposable PostgreSQL instance;
- persist allow and deny decisions;
- restart runtime and consume an unused grant;
- run 16 concurrent consumes and observe exactly one success;
- prove replay, expiry, stale policy, cross-tenant, and cross-actor denial;
- prove append-only decision/event triggers and restricted grant mutation;
- return exact synthetic Korean name, mixed-script address, phone, and email after authorized consumption;
- search serialized rows, logs, problems, tokens, and metrics for every synthetic PII value and prove absence.

## Task 7: Package, Compose, and operator evidence

**Files:**

- Create: `apps/privacy-service/package.json`
- Create: `apps/privacy-service/tsconfig.json`
- Create: `apps/privacy-service/nest-cli.json`
- Create: `apps/privacy-service/vitest.config.ts`
- Create: `apps/privacy-service/Dockerfile`
- Update: `pnpm-lock.yaml`
- Update: `compose.yaml`
- Update: `.env.example`
- Create: `docs/operations/purpose-bound-pii-access.md`
- Update: `README.md`
- Update: `ARCHITECTURE.md`
- Update: `AGENTS.md`
- Update: `CLAUDE.md`
- Update: `CHANGELOG.md`
- Update: `product/capabilities.json`

**Evidence:**

- independent service build and container health;
- dedicated schema migration ownership;
- secret separation and rotation procedure;
- SOC 2, CSAP, ISMS-P, NIST, ISO control mapping and residual responsibilities;
- operational access review and break-glass review procedure;
- no masking policy and authorized-payload handling rules.

## Task 8: Complete exact-head review and merge loop

1. Open a draft PR from `feat/purpose-bound-pii-access`.
2. Run formatting, lint, typecheck, 100% coverage, build, Compose, and PostgreSQL integration tests.
3. Remove every temporary write-capable generation/repair workflow.
4. Review all human, CodeRabbit, AppGuardrail, Semgrep, and security feedback.
5. Fix root causes and add realistic regressions.
6. Resolve only addressed threads.
7. Re-run all required checks on the exact clean head.
8. Mark ready and squash-merge only when branch protection accepts the exact head.
9. Confirm issue closure and update the commercial-readiness loop.
