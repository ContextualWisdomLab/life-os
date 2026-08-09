# LifeOS Test Strategy

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Objective

LifeOS tests prove customer-visible behavior, authority boundaries, durability, failure/recovery and release evidence. A test suite is not considered strong merely because it invokes code or achieves a numerical coverage threshold.

## 2. Test pyramid by boundary

### Unit/domain tests

Use for pure invariants and deterministic transformations:

- goal/project/task/habit state rules;
- recurrence/local-time policy;
- UUID/signature/digest/schema validation;
- provider/model response parsing;
- proposal quality scoring;
- privacy purpose/grant validation;
- projection/rendering/serialization contracts.

Tests assert outcomes and failures, not implementation call counts alone.

### Repository/PostgreSQL integration tests

Required when persistence semantics are material:

- tenant-scoped reads/writes;
- transaction rollback;
- uniqueness/idempotency;
- concurrent winners;
- immutable/append-only evidence;
- claim expiry/recovery;
- exact expiry boundaries;
- restart durability;
- migration constraints and unsafe mutation rejection.

Use disposable databases/isolated schemas and exercise real SQL.

### HTTP/service integration tests

Required for:

- OAuth/session callback/error handling;
- session-derived tenant/actor scope;
- signed private service context;
- bounded request/response parsing;
- problem/error mapping;
- stale conflict/idempotency behavior;
- provider failure sanitization;
- service bootstrap/shutdown.

### Browser/E2E tests

Cover primary journeys with the real web boundary:

- onboarding/login surface where practical with bounded provider stubs;
- Today capture, priorities and completion;
- planning search and stale-request protection;
- Korean/English localization;
- keyboard/focus/accessibility behavior;
- responsive/mobile/PWA installation/offline-draft state;
- proposal view/decision UX where exposed.

### Provider/contract tests

- Google/GitHub OAuth response contracts with safe fixtures;
- Google Calendar/CalDAV identifiers/ETags/preconditions;
- plugin manifest/event schemas;
- contextual-orchestrator/OpenAI-compatible response bounds;
- NATS/event schema and idempotent consumer behavior.

Live external providers are never the only deterministic merge oracle.

## 3. Required negative testing

Every ownership/security-sensitive feature includes realistic negative cases for applicable classes:

- other-workspace identifier;
- malformed/non-v4/sequential internal ID;
- missing/expired/replayed session or signed context;
- wrong HTTP method/path signature;
- duplicate idempotency key with same/different payload;
- stale revision/digest/ETag;
- concurrent workers/writers;
- oversized body/collection/text;
- malformed Unicode/JSON/provider row;
- provider redirect/origin confusion;
- secret-shaped content/logging;
- prompt injection/untrusted-model text;
- expired/reused privacy grant;
- backup checksum corruption/non-empty restore target;
- deployment rollback failure;
- stale browser response after query/navigation/unmount.

## 4. Coverage policy

Packages that declare exact coverage gates maintain **100% statement, branch, function and line coverage for owned production code where technically meaningful**.

Coverage is not accepted when achieved by:

- empty assertions;
- source rewriting in CI;
- excluding reachable production branches without rationale;
- replacing a failing behavioral test with a looser check;
- invoking code without validating the result;
- treating skipped/ignored required tests as pass.

A coverage gap should usually be resolved by clarifying behavior and adding a realistic assertion; unreachable code should be removed or justified rather than hidden.

## 5. Deterministic versus live AI evidence

### Deterministic merge gates

Must run without requiring a live model provider:

- proposal schema/operation validation;
- ownership/signed-context validation;
- prompt-injection fixtures;
- forbidden/leakage text detection;
- proposal persistence/decision semantics;
- provider response bounding/error classification;
- orchestration policy configuration and artifact sanitation.

### Bounded live conformance

May use `NVIDIA_NIM_API_KEY` through the approved model boundary to measure:

- real proposal validity/grounding/utility;
- prompt-injection resistance;
- strong-single-route versus bounded orchestration behavior;
- provider/model provenance and bounded usage metrics.

Provider unavailable/rate-limit/malformed response is recorded as unavailable/failure evidence. It never fabricates a score and does not silently disable deterministic gates.

## 6. Security test gates

Applicable exact-head PRs must pass configured repository gates such as:

- AppGuardrail;
- Semgrep/SAST;
- GitHub Advanced Security/code scanning;
- secret/dependency/supply-chain checks;
- repository-specific commercial-readiness/security contracts.

A status/check is valid only for the exact current head and correct checkout semantics. Queued, absent, cancelled, skipped-required, action-required, stale-head or predecessor-head evidence is not promoted to success.

## 7. Accessibility and localization testing

Core journeys test:

- keyboard-only operation;
- visible focus and semantic controls;
- accessible names/live regions;
- reduced motion where relevant;
- no color-only status;
- Korean and English catalog key parity;
- interpolation/fallback behavior;
- narrow/mobile viewport interactions;
- print/export exact values where a reporting feature requires them.

Automated checks supplement rather than replace manual assistive-technology review for release-critical interaction changes.

## 8. Time and concurrency testing

Use deterministic clocks/fixtures for:

- IANA timezone offsets and DST transitions;
- quiet hours crossing local-day boundaries;
- claim/grant/session expiry at the exact boundary;
- stale request ordering;
- duplicate/replayed commands;
- concurrent PostgreSQL transactions;
- optimistic-concurrency conflicts.

Do not use arbitrary sleeps where a deterministic barrier/clock/transaction control can prove the behavior.

## 9. Backup, migration and deployment testing

### Backup/restore

Exercise real PostgreSQL tooling and verify:

- archive/checksum creation;
- exact expected tenant records after restore;
- checksum-corruption refusal;
- non-empty-target refusal;
- bounded credential-free failure evidence.

### Migrations

For schema changes verify as applicable:

- migration applies on supported prior state;
- existing valid records remain valid;
- new constraints reject invalid state;
- rollback or forward-fix strategy is explicit;
- application compatibility during rollout is understood.

### Deployment reference

Verify rendered Kubernetes/Compose artifacts, immutable image/source requirements, probe/security/network-policy contracts, dry-run behavior and claimed workload rollback semantics without claiming infrastructure provisioning not supplied by the repository.

## 10. Documentation consistency tests

The canonical documentation graph should receive machine-checkable regression coverage for:

- required canonical file presence;
- README/documentation index links;
- ADR index entries and allowed statuses;
- balanced Markdown code fences and parseable Mermaid blocks where tooling permits;
- current service/bounded-context names;
- UUIDv4 and service-data-ownership invariants;
- no canonical statement that UUIDv7 or browser-only local storage is current architecture;
- `Implemented on active PR` not being presented as protected-main behavior;
- traceability entries pointing to existing paths or explicit open gaps.

These tests should compare against repository source/config/migrations rather than checking prose existence only.

## 11. Test-first defect workflow

For a valid product defect:

1. reproduce/locate the first failing boundary;
2. write the smallest realistic regression that fails for the defect;
3. run it and observe RED for the intended reason;
4. implement the narrowest causal fix;
5. run focused GREEN;
6. run affected package and repository gates;
7. refetch exact PR head and external checks;
8. resolve only review threads whose underlying cause is fixed.

For pure documentation drift where no runtime behavior changes, the RED oracle is a documentation consistency check or direct exact-source comparison; do not invent product code merely to satisfy TDD ceremony.

## 12. Release test evidence

A stable release requires one exact protected integrated head with applicable:

- repository CI;
- security/SAST/dependency gates;
- exact owned-code coverage;
- browser/accessibility/localization journeys;
- PostgreSQL migration/integration evidence;
- backup/restore evidence;
- Compose/Kubernetes reference validation;
- package/container build and smoke tests;
- SBOM/provenance/reproducibility evidence under release policy;
- no valid unresolved review/security finding.

Tests from an older head/base, synthetic merge only, or a temporary repair branch are not a substitute for final-head evidence.
