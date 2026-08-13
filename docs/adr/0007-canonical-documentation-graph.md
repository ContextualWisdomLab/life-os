# ADR 0007: Canonical documentation graph

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
Feature specs, runbooks, PR bodies and chat history accumulated faster than a whole-product source of truth. Historical architecture also changed from local-first/single-app/UUIDv7 exploration to server-backed MSA/UUIDv4 behavior.

## Decision drivers
Discoverability, code-current truth, explicit maturity, reviewability, machine-checkable consistency and acquisition diligence.

## Alternatives considered
- rely on README/PR bodies/chat — rejected;
- duplicate architecture in many feature specs — rejected;
- one indexed canonical graph plus scoped feature docs — selected.

## Decision
Maintain canonical PRD, TRD, root Architecture, ADR index/records, Data Model/ERD, UML, API/event contracts, Security/Threat Model, Privacy Lifecycle, Test Strategy, Operability, Release/Migration, Standards/Research and Traceability. Status fields use only the exact repository vocabulary and qualifiers/PR numbers belong in evidence prose. Diagrams distinguish conceptual/planned from actually persisted/shipped entities.

## Consequences
Material product/authority changes require multi-view reconciliation, but GitHub can reconstruct product truth without conversation archaeology.

## Failure and recovery
A stale/diverged canonical docs PR is not kept alive merely for ancestry. Create/reuse one clean successor from exact current main, preserve/reconcile unique content, prove it, then close the obsolete line as superseded. Resolved historical reviews are not permanent correctness evidence.

## Security and privacy impact
Canonical docs must not embed credentials, raw tenant data, prompts/responses or hidden reasoning. Security boundaries and ownership are documented without exposing secret material.

## Acceptance evidence
The canonical documentation consistency test validates required files/links/statuses/ADR targets/diagram fences and key source-aligned claims before protected-main integration.

## Migration and rollback
When canonical names/paths change, update README/index/test links atomically. Rollback returns to the last coherent graph, not to chat-only authority.

## Supersession
A future documentation architecture may supersede this ADR only if it preserves one discoverable code-current authority graph and explicit implementation maturity.