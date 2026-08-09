# LifeOS Standards and Research Traceability

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Purpose

LifeOS has feature-level standards/research documents under `docs/research/` and approved specifications. This index prevents those references from becoming disconnected citations by mapping **why a standard/research family matters, which product boundary uses it, and where implementation evidence lives**.

This file does not copy full bibliographies from scoped research documents. The scoped document remains authoritative for exact APA 7 citation, publication status, version/date and evidence limitations.

## 2. Evidence classes

Use these labels when adding a source:

- **Normative standard/specification** — protocol/security/accessibility semantics that implementation claims to follow.
- **Authoritative guidance** — operational/security practice from a primary maintainer/body.
- **Peer-reviewed research** — evidence informing product/statistical/model design.
- **Preprint/technical report** — useful but not equivalent to peer-reviewed/final standard evidence.
- **Repository experiment** — LifeOS fixture/ablation/benchmark evidence; product-specific and reproducible.

Do not present a preprint or internal benchmark as a normative standard.

## 3. Standards / research map

| Area | Source family | Product decision / use | Repository evidence |
| --- | --- | --- | --- |
| OAuth/OIDC | OAuth/OIDC/provider specifications and provider docs | bounded Google/GitHub login, callback/state, provider identity mapping | identity-service source/tests and feature plans |
| HTTP conditional/replay semantics | HTTP conditional request semantics | calendar ETag conflict safety, stale write classification | calendar provider adapters/tests; issue #51 completion evidence |
| iCalendar/CalDAV | iCalendar + CalDAV standards | deterministic VEVENT/resource identity and non-destructive sync | calendar integration source/tests |
| Accessibility | WCAG/WAI platform semantics | keyboard/focus/non-color-only/localized core journeys | web accessibility E2E and scoped plans |
| Time zones | IANA zone semantics/runtime libraries | reminder quiet hours, DST-safe local-calendar behavior | notification scheduler tests/runbook |
| CloudEvents/event envelope concepts | versioned event-envelope practices | bounded immutable domain-event identity/correlation/causation | `packages/contracts/`, plugin SDK/tests |
| Kubernetes/container hardening | Kubernetes/runtime/security guidance | restricted non-root/read-only reference workloads, probes, network/disruption/topology boundaries | `infra/kubernetes/`, infra tests, production deployment runbook |
| Software supply chain | SBOM/provenance/action/dependency pinning guidance | exact source/artifact identity, pinned external actions, release evidence | workflows/security/commercial-readiness tests |
| OWASP application security | application/security threat classes | tenant/auth/SSRF/secret/subprocess/prompt-injection regressions | AppGuardrail/Semgrep/GHAS, threat model, scoped security docs |
| NIST AI risk guidance | AI governance/evaluation | deterministic validation, provenance, provider/live-evidence separation | AI quality/live-conformance specs/tests |
| Fugu / Conductor / TRINITY / strong-single-agent research | agent compute-allocation evidence | strong single-route baseline; deeper orchestration only when measured benefit justifies it | AI live-conformance design/research docs and tests |
| PostgreSQL semantics | PostgreSQL documentation/behavior | transactions, unique/idempotency constraints, migrations, dump/restore | service integration tests, backup/recovery runbook |
| Cryptographic primitives | platform cryptography/API guidance | SHA-256 digests, HMAC context, key rotation, encrypted secret boundaries | identity/AI/privacy/data-rights tests and runbooks |

## 4. Current scoped research documents

Representative current evidence includes:

- `docs/research/2026-08-04-ai-gateway-key-rotation-standards.md`
- `docs/research/2026-08-05-contextual-orchestrator-proposal-transport-standards.md`
- `docs/research/2026-08-05-ai-proposal-quality-evaluation-standards.md`
- `docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md`
- privacy/security/operations feature specifications that contain exact standards references.

When a scoped research document is superseded, update this index and the owning ADR/spec rather than deleting historical rationale silently.

## 5. AI research traceability rule

For model routing/orchestration claims:

1. record source publication status;
2. state the claim actually supported by the source;
3. define the LifeOS fixture/metric that tests whether the claim transfers to this product;
4. retain a strong single-route baseline;
5. measure quality/safety, not only latency/token use;
6. do not turn a paper's agent count/topology into a repository requirement without measured product evidence;
7. keep provider/model availability separate from deterministic policy validity.

## 6. Security standards traceability rule

A security citation is not a mitigation. Every cited security requirement maps to:

- a trust boundary/threat in `docs/THREAT_MODEL.md`;
- a deterministic validator/policy where applicable;
- a negative exploit/regression test;
- least-privilege/runtime/deployment configuration where applicable;
- exact-head scanner/review evidence.

## 7. Protocol standards traceability rule

For OAuth/calendar/events/API protocols:

- record the protocol/version/date in the scoped design or contract when semantics depend on it;
- add real serialization/parsing/conditional-request tests;
- distinguish provider extension from protocol standard;
- preserve unknown-version fail-closed behavior;
- record compatibility/migration when the protocol contract changes.

## 8. Accessibility traceability rule

Accessibility requirements must map to actual interaction behavior and tests. A design-system token or ARIA attribute by itself does not prove a user can complete the journey. Core journeys combine semantic controls, keyboard flow, visible focus, status announcements, localization, reduced-motion behavior and responsive layout evidence.

## 9. Research and standards update process

When adding or changing a material evidence source:

1. prefer primary normative or peer-reviewed sources;
2. verify the current version/status when the decision is time-sensitive;
3. record APA 7 citation and stable link in the scoped research/spec document;
4. state whether it is final standard, peer-reviewed article, preprint/technical report or internal experiment;
5. map it to a product/technical/ADR decision and test oracle;
6. update this index if the repository-wide boundary changes;
7. do not cite a source merely to decorate an already-decided implementation.

## 10. Mathematical and psychometric future modules

No production psychometric compute module is currently claimed. If added, research traceability must additionally specify estimand/model equations, data-generating assumptions, true-parameter recovery design, multilevel/multiple-membership/temporal requirements, numerical precision/convergence, CPU/GPU parity and publication status for methodological sources.

## 11. Release criterion

A stable release does not require every research question to be closed. It does require every **material product claim based on standards/research** to have a clear source class, scoped reference, implementation/test mapping and no known contradiction presented as established fact.
