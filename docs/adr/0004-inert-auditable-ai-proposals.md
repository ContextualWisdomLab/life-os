# ADR-0004: AI proposals are inert and auditable

**Status:** Accepted  
**Date:** 2026-08-09

## Context

LifeOS can use models for planning assistance, but personal planning state is user-owned. Allowing model output to directly mutate tasks/goals/habits would merge probabilistic generation, authorization and transactional authority into one unsafe boundary.

## Drivers

- preserve user agency;
- prompt-injection/model-error containment;
- durable provenance and review;
- provider portability;
- replay-safe explicit decisions;
- deterministic product validation independent of provider availability.

## Alternatives

1. Let the model call arbitrary mutation tools.
2. Let the AI service own a planning repository/command bus.
3. Persist inert proposals, validate them deterministically and record explicit accept/reject decisions separately.

## Decision

AI/model output is untrusted, inert proposal data. The AI service may generate, validate, persist and retrieve proposal evidence and append explicit decision events. It does not receive generic planning mutation authority. Browser credentials/provider secrets are not forwarded to the model.

A strong single-model route is the evaluation baseline; deeper orchestration requires measured benefit without safety regression.

## Consequences

- Proposal acceptance does not implicitly mean planning mutation exists; any future execution capability requires a separately authorized contract.
- The product can audit what was proposed and what the user decided.
- Live provider outages do not require weakening deterministic CI/product gates.

## Failure/recovery

Malformed model output, stale proposal revisions, unavailable providers and validation failures produce bounded classified evidence. They never fabricate a successful proposal/decision or silently mutate planning data.

## Security/privacy impact

Reduces prompt-injection blast radius and credential exposure. Retained artifacts exclude raw prompts/responses, hidden reasoning, credentials and unbounded tenant data.

## Acceptance evidence

Protected-main AI proposal persistence, same-origin signed-context tests, append-only/replay-safe decision tests, proposal-quality evaluator, and root architecture boundary.

## Migration/rollback

Future execution actions must map accepted proposal intent to narrowly authorized domain commands and preserve proposal/decision provenance. Rollback disables execution without corrupting proposal history.

## Supersession

Only a reviewed ADR with an equally strong authorization, provenance, user-consent, prompt-injection and rollback model may change this authority split.
