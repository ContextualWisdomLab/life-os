# Onboarding first-plan slice

## Goal

Let a new user reach a useful Today plan in about one minute without reading documentation or configuring infrastructure.

## Scope

- add a dedicated `/onboarding` route with an accessible, responsive first-run flow
- ask for one direction, one visible next action, and an optional time block
- reuse the validated Today domain and storage contract rather than inventing a parallel draft format
- preserve any existing Today actions and use the next available priority slot
- state the browser-local trust boundary before the user commits data
- verify plan creation, required-input refusal, persistence handoff, and mobile usability with Playwright

## Safety boundary

This slice does not create an account, infer identity, synchronize a workspace, persist the direction as a durable goal, contact external services, or overwrite an existing Today draft. Authentication, durable goal creation, cross-device continuation, analytics, and experimentation remain separate reviewed slices.

## Acceptance gate

Formatting, linting, type checking, unit tests, build, Compose validation, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all actionable human or security feedback must pass on the exact merge head. The Playwright contract must remain deterministic and usable on desktop and mobile Chromium profiles.
