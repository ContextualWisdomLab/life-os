# First-run onboarding slice

## Outcome

A genuinely new browser reaches a useful Today plan in a few bounded steps without reading deployment documentation, configuring integrations, or silently replacing an existing local draft.

## Included capability

- detect an empty browser-local Today draft with no valid onboarding completion receipt and route it to `/onboarding`;
- leave existing drafts and storage-denied browsers on the usable Today surface rather than creating redirect loops;
- collect one bounded weekly focus, one visible next action, and an optional 15-minute-granularity time block;
- create opaque UUIDv4 action identity and canonical UTC completion evidence;
- reuse the existing Today domain for title validation, three-priority capacity, schedule bounds, and deterministic overlap detection;
- preserve every existing Today action and add the onboarding action as the next priority only when capacity remains;
- add the action to backlog when all three priority positions are occupied rather than displacing a commitment;
- reject an optional schedule when no priority slot remains and reject overlapping blocks instead of silently moving existing work;
- persist a strict versioned completion receipt and bounded Today draft;
- pre-serialize both values, retain prior browser values, and attempt rollback when either storage write fails so partial setup is never reported as success;
- keep `/onboarding` directly addressable so a user can intentionally revisit the planning guide;
- add deterministic domain tests and responsive Playwright flows for empty first run, reload persistence, existing-draft preservation, overlap refusal, and mobile keyboard operation.

## Trust and data boundary

This slice is browser-local. It does not create an account, provision a workspace, infer identity, synchronize across devices, write to planning-service persistence, send telemetry, or configure integrations. The interface states that boundary before submission.

The first-run redirect reads only the versioned onboarding receipt and the existing bounded Today draft. A malformed or oversized onboarding receipt is treated as absent. A malformed Today draft continues to use the existing fail-closed storage behavior. Storage access failure never causes a redirect and does not disable the existing Today interface.

## Failure behavior

- Invalid or oversized fields fail before any storage write.
- Schedule conflicts leave the caller's immutable Today draft unchanged.
- Both new serialized values are computed before storage mutation.
- If either browser write fails, LifeOS best-effort restores both previous values and presents an explicit persistence warning.
- No setup path deletes, renumbers, completes, reschedules, or replaces an existing action.
- A user with three existing priorities receives a backlog action with an explicit placement receipt.

## Deferred production capability

Subsequent slices must add authenticated account bootstrap, durable workspace creation, locale and timezone preferences, cross-device resume, starter templates, consent-aware product analytics, and progressive disclosure for calendar, AI, import, and reminder capabilities. Durable onboarding must derive workspace ownership from the authenticated gateway rather than browser payload data.

## Validation gate

Merge only when formatting, type checking, Today and onboarding domain tests, responsive browser flows, production build, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every human/security review finding pass on the exact current head with no unresolved actionable item.

## Rollback

The change is additive and browser-local. Revert the onboarding route, redirect component, state module, styles, tests, and documentation. Existing `life-os.today-draft.v1` data remains compatible. The optional `life-os.onboarding.v1` receipt can remain harmlessly in browser storage because the prior application does not read it.

Refs #21.
