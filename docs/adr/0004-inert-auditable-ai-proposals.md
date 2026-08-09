# ADR 0004: Inert, auditable AI proposals

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS uses AI to assist prioritization, reflection and planning, but personal state must not become silently mutable because a model produced text or structured output. Provider availability and model quality also vary independently from core product correctness.

## Decision drivers

- user authority over personal state;
- prompt-injection/model-error containment;
- auditable accept/reject history;
- deterministic testing independent of live providers;
- provider-neutral evolution.

## Considered alternatives

1. Let model output directly execute planning mutations — rejected.
2. Treat AI output as trusted suggestions without durable evidence — rejected.
3. Persist inert proposals/evidence and require explicit deterministic/user decision — selected.

## Decision

Model output is untrusted proposal data. The AI service validates bounded structure, persists proposal evidence/digests, exposes explicit decision operations and has no generic planning mutation repository. Accept/reject binds exact proposal identity/revision/digest, actor/workspace and idempotency evidence. Deterministic proposal-quality/security tests remain authoritative for merge correctness; bounded live-provider conformance is separate governance evidence.

## Consequences

- AI assistance adds an explicit proposal/decision step;
- consumers must map accepted proposals through their own typed product commands;
- live provider outage can degrade AI without making core planning unavailable;
- richer orchestration is justified only by measured evidence.

## Failure and recovery

Malformed/provider-failed model results become bounded proposal failures/unavailability. Stale/replayed decisions fail closed. Audit evidence allows operators/users to distinguish generation from acceptance.

## Security and privacy impact

Model input is bounded; credentials/browser sessions/GitHub review secrets are excluded. Raw prompts/responses/hidden reasoning do not become retained public CI evidence. Prompt injection cannot grant product mutation authority.

## Acceptance evidence

Protected main includes AI proposal/audit persistence, decision tests, deterministic proposal-quality fixtures, prompt-injection regressions and bounded NVIDIA/contextual-orchestrator conformance.

## Migration and rollback

Any future automatic action must be introduced as a separately typed, authorized product capability with its own ADR/tests. Rolling back an AI model/provider does not alter already persisted user decisions.

## Supersession

This ADR supersedes any historical interpretation of “AI Planner/Agent” as unrestricted autonomous mutation authority.