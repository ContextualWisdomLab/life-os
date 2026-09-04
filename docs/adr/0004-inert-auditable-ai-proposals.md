# ADR 0004: Inert, auditable AI proposals

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
LifeOS can use models to propose planning assistance, but personal state must remain user/product-authorized and model/provider output is untrusted.

## Decision drivers
User authority, auditability, provider independence, prompt-injection resistance, deterministic safety, graceful provider failure.

## Alternatives considered
- model directly mutates planning state — rejected;
- model emits generic executable commands — rejected;
- model returns bounded proposal evidence with explicit accept/reject — selected.

## Decision
AI output is inert structured proposal data. The AI service validates and persists proposal evidence before return, records explicit decisions, and has no generic planning mutation repository/command bus. Decisions bind actor/workspace and exact proposal revision/digest. Deterministic validation/authorization remains authoritative and live provider availability is not a deterministic PR merge gate.

## Consequences
The product needs proposal/evidence/decision storage and explicit UX, but provider or orchestration changes cannot silently change user-owned state.

## Failure and recovery
Malformed/unsafe/provider-unavailable output returns sanitized failure/unavailable evidence. Stale/replayed proposal decisions fail closed. Provider retry must not duplicate decisions.

## Security and privacy impact
Browser credentials, provider credentials, raw prompts/responses and hidden reasoning are excluded from retained public artifacts. Page/document/model content cannot elevate itself to policy authority.

## Acceptance evidence
Protected-main AI proposal/audit persistence, same-origin authenticated BFF, signed context, proposal-quality evaluator and explicit decision tests.

## Migration and rollback
Proposal schema changes are versioned. Rollback preserves immutable historical proposal/decision evidence and cannot reinterpret old proposal content as commands.

## Supersession
A future AI execution architecture requires a separate reviewed capability/authorization ADR and cannot silently widen this proposal authority.