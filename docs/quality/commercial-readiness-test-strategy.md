# Commercial Readiness test strategy

This document defines the active quality contract for `packages/commercial-readiness`. It records test authority; it does not promote an open branch into protected-main or release truth.

## Production documentation contract

Every production declaration discovered by the package's AST-backed docstring gate must have explanatory JSDoc. The denominator is the complete supported production `.mjs` declaration surface, not only touched lines. The gate is 100%; exclusions, threshold relaxation, empty blocks, declaration-name restatements, and generic filler such as “does something” are not acceptable ways to satisfy it. Hostile fixtures must prove that absent, detached, empty, and generic documentation fails closed. Comments should explain non-obvious contract, failure semantics, security boundary, bounded I/O, provenance, atomic publication, or another reason that is not already obvious from the code.

## Required verification

Repository `pnpm@10.15.0` frozen installation precedes package checks. The Commercial Readiness package must pass formatting, lint, typecheck where applicable, tests, build, and the permanent documentation gate. Changed control-plane contracts also require their focused hostile fixtures and the normal contributor-triggered repository CI. Predecessor GREEN is not transferred to a descendant SHA. A temporary write-capable repair workflow must delete itself before its candidate commit and may publish only while the remote source head is unchanged.

The current active-PR evidence is `ContextualWisdomLab/life-os#249@09d1430ec0f3266740266519af36e78907482ca1`: CI `34448871673`, Commercial Readiness `34448871653`, SAST `34448871714`, and AppGuardrail `34448871643` are SUCCESS. Security and CodeQL are not reclassified as local package failures when their exact jobs show central evidence-path failures; they remain fail closed and are repaired at the canonical `.github` owner.

## Promotion boundary

A Draft or mergeable PR, a successful package test, or a successful predecessor run is not shipped evidence. Promotion still requires exact current-head applicable checks, independent review authority, normal protected-branch integration, and release evidence.
