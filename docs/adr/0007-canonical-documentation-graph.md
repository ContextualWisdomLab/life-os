# ADR-0007: Canonical documentation graph with code-current status

**Status:** Accepted architecture  
**Date:** 2026-08-09

## Context

LifeOS accumulated valuable feature specifications, plans, research notes and runbooks, but the whole product could not be reconstructed without reconciling a stale initial design, protected-main source, capability evidence, changelog entries, old PRs and conversation history. Several canonical document families were absent.

A later failure mode showed that even a previously resolved review thread is insufficient proof of current correctness: subsequent branch movement can reintroduce invalid composite status values or weaken documentation-contract tests. Therefore exact-current source, not review history or file presence, is the documentation authority.

## Drivers

- acquirer/operator/contributor comprehension from the repository alone;
- explicit separation of shipped versus planned behavior;
- traceability from requirement/decision to code/test/runbook;
- preservation of superseded rationale without parallel sources of truth;
- machine-checkable semantic documentation consistency;
- exact-current-head verification after every documentation mutation;
- documentation findings that feed implementation rather than ending work.

## Alternatives

1. Keep feature plans/specs as the only documentation.
2. Replace all historical docs with one monolithic document.
3. Check only that canonical document files exist.
4. Maintain a small canonical documentation spine that indexes scoped evidence, records exact status/supersession explicitly, and validates key claims against current source/configuration/migrations.

## Decision

LifeOS maintains:

- `docs/PRD.md`;
- `docs/TRD.md`;
- root `ARCHITECTURE.md`;
- `docs/adr/README.md` and material ADRs;
- `docs/DATA_MODEL.md`;
- `docs/UML.md`;
- `docs/API_CONTRACTS.md`;
- `SECURITY.md` and `docs/THREAT_MODEL.md`;
- `docs/PRIVACY_DATA_LIFECYCLE.md`;
- `docs/TEST_STRATEGY.md`;
- `docs/OPERABILITY.md`;
- `docs/RELEASE_AND_MIGRATION.md`;
- `docs/STANDARDS_TRACEABILITY.md`;
- `docs/TRACEABILITY.md`;
- `docs/DOCUMENTATION_ASSESSMENT.md`;
- scoped research, runbooks, legal docs, specs/plans, capability manifest and changelog as supporting evidence.

Canonical documents and ADRs use only these exact status categories: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, and `Out of scope`. PR numbers, scope qualifiers such as `reference`, implementation notes and other evidence belong outside the status value.

Machine-checkable documentation tests validate more than presence. They verify canonical local link targets, exact ADR index targets and material ADR set, exact status vocabulary, balanced fences, key service/data/AI authority claims against real repository evidence, and live buyer-gap/active-PR traceability that would otherwise silently drift.

A resolved review comment is historical evidence only. If current exact source contradicts the accepted contract, repair the current source and regression test even if the old thread remains resolved.

Historical files remain available but are marked/indexed as historical when superseded.

## Consequences

- Documentation changes require evidence review, not merely prose review.
- Product status can be read without treating roadmaps or active PRs as shipped behavior.
- Architecture drift such as UUID version, service ownership, active buyer-gap implementation, or readiness semantics is visible sooner.
- API/event, privacy/data lifecycle, migration/release, and standards/research claims have explicit canonical indexes instead of being inferred from unrelated feature prose.
- The canonical docs stay concise by linking scoped evidence rather than copying every feature spec.
- Documentation tests may intentionally fail when current docs lag a new active PR; that failure is a synchronization defect, not a reason to weaken the contract.

## Failure/recovery

If docs disagree with protected-main code/tests, the implemented claim is downgraded/corrected immediately; documentation is not used to override behavior. If docs lag a current active implementation, mark it `Implemented on active PR` with exact PR evidence rather than prematurely upgrading protected-main status.

If a doc reveals a genuine implementation gap, the maintenance loop creates/advances the smallest executable product/test/migration change rather than declaring completion at the audit. If a later commit reintroduces a documentation defect, current-source revalidation reopens the causal repair regardless of historical thread resolution.

## Security/privacy impact

Canonical docs must not embed credentials, private user data, exploit details that belong in private security reports, raw model traces or unnecessary sensitive examples. Threat/security/privacy lifecycle boundaries become easier to audit. Link and evidence validation must not fetch arbitrary external content as part of a deterministic merge gate.

## Acceptance evidence

- presence and review of the canonical files;
- real local links from README/architecture/agent contracts;
- status/evidence mapping in `docs/TRACEABILITY.md`;
- exact-current-head machine-checkable documentation consistency tests;
- source/configuration/migration evidence for key architecture claims;
- active PRs and canonical buyer gaps represented without being promoted to protected-main implementation.

## Migration/rollback

No product-data migration is required. Existing specs/plans are retained. Incorrect canonical content can be reverted independently while source/test truth remains intact. Documentation-contract strengthening is additive; if a new check is wrong, correct the check and its documented contract rather than weakening unrelated product gates.

## Supersession

Supersede if the repository adopts another documentation system that preserves equivalent authority, exact status vocabulary or an explicitly migrated replacement, API/data/privacy/release/standards traceability, historical rationale, active-PR/protected-main distinction, and machine-verifiable semantic consistency.
