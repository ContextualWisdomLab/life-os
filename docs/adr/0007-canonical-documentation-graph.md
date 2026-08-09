# ADR 0007: Canonical documentation graph

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS accumulated feature designs, plans, runbooks, research notes and implementation evidence faster than a whole-product documentation spine. PR #126 created a broad baseline, but protected main advanced while that branch remained open, so its status and ancestry are no longer a clean integration baseline.

## Decision drivers

- reconstruct LifeOS from GitHub without chat archaeology;
- distinguish protected-main, active-PR, partial, planned and superseded behavior;
- keep documentation aligned with current source and migrations;
- preserve useful historical rationale without carrying unrelated branch history.

## Considered alternatives

1. Keep feature plans as the only documentation — rejected because whole-product truth remains fragmented.
2. Keep a stale long-lived docs branch as the only integration path — rejected because old review status does not prove current correctness.
3. Maintain one canonical graph and use a clean successor from current main when the prior documentation branch materially diverges — selected.

## Decision

The canonical graph includes PRD, TRD, root Architecture, ADR index/records, logical ERD/data model, UML, API/event registry, Security, Threat Model, Privacy/Data Lifecycle, Test Strategy, Operability, Release/Migration, Standards/Research, Traceability and Documentation Assessment.

Canonical status fields use exactly `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, or `Out of scope`.

When the active canonical documentation branch becomes materially diverged from protected main, create or reuse one clean successor branch from exact current main, preserve and reconcile the unique documentation content, verify the successor, then close the old docs PR as superseded.

## Consequences

- current product truth becomes discoverable from one graph;
- active PRs/issues are not represented as shipped behavior;
- documentation consistency becomes testable;
- stale documentation ancestry can be replaced without losing historical rationale.

## Failure and recovery

If the successor is incomplete, keep the old PR open as historical/reference evidence until required content is preserved. Documentation changes never change product state by themselves.

## Security and privacy impact

Canonical public documentation uses synthetic/credential-free examples and does not copy tenant data or confidential runtime evidence.

## Acceptance evidence

This successor branch starts from current protected main and reconstructs the canonical documentation families while reconciling current protected-main and active-PR state. Exact-head checks and review remain required before merge.

## Migration and rollback

Open a successor documentation PR first; verify preservation/currentness; only then close PR #126 as superseded. Reverting documentation does not revert product code.

## Supersession

This ADR supersedes the assumption that the first canonical documentation branch must remain the only integration path after material divergence.