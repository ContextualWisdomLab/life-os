# ADR-0007: Canonical documentation graph with code-current status

**Status:** Accepted  
**Date:** 2026-08-09

## Context

LifeOS accumulated valuable feature specifications, plans, research notes and runbooks, but the whole product could not be reconstructed without reconciling a stale initial design, protected-main source, capability evidence, changelog entries, old PRs and conversation history. Several canonical document families were absent.

## Drivers

- acquirer/operator/contributor comprehension from the repository alone;
- explicit separation of shipped versus planned behavior;
- traceability from requirement/decision to code/test/runbook;
- preservation of superseded rationale without parallel sources of truth;
- machine-checkable documentation consistency;
- documentation findings that feed implementation rather than ending work.

## Alternatives

1. Keep feature plans/specs as the only documentation.
2. Replace all historical docs with one monolithic document.
3. Maintain a small canonical documentation spine that indexes scoped evidence and records supersession/status explicitly.

## Decision

LifeOS maintains:

- `docs/PRD.md`;
- `docs/TRD.md`;
- root `ARCHITECTURE.md`;
- `docs/adr/README.md` and material ADRs;
- `docs/DATA_MODEL.md`;
- `docs/UML.md`;
- `SECURITY.md` and `docs/THREAT_MODEL.md`;
- `docs/TEST_STRATEGY.md`;
- `docs/OPERABILITY.md`;
- `docs/TRACEABILITY.md`;
- scoped research, runbooks, legal docs, specs/plans, capability manifest and changelog as supporting evidence.

Canonical documents use exact status categories: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, and `Out of scope`.

Historical files remain available but are marked/indexed as historical when superseded.

## Consequences

- Documentation changes require evidence review, not merely prose review.
- Product status can be read without treating roadmaps as shipped behavior.
- Architecture drift such as UUID version or service additions is visible sooner.
- The canonical docs stay concise by linking scoped evidence rather than copying every feature spec.

## Failure/recovery

If docs disagree with protected-main code/tests, the implemented claim is downgraded/corrected immediately; documentation is not used to override behavior. If a doc reveals a genuine implementation gap, the maintenance loop creates/advances the smallest executable product/test/migration change rather than declaring completion at the audit.

## Security/privacy impact

Canonical docs must not embed credentials, private user data, exploit details that belong in private security reports, raw model traces or unnecessary sensitive examples. Threat/security boundaries become easier to audit.

## Acceptance evidence

Presence and review of the canonical files, links from README/architecture/agent contracts, status/evidence mapping in `docs/TRACEABILITY.md`, and future documentation consistency tests.

## Migration/rollback

No source behavior changes are required. Existing specs/plans are retained. Incorrect canonical content can be reverted independently while source/test truth remains intact.

## Supersession

Supersede if the repository adopts another documentation system that preserves equivalent authority, status, traceability, historical rationale and machine-verifiable consistency.
