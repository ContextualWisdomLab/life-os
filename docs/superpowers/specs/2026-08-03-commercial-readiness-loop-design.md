# LifeOS Commercial Readiness Control Loop Design

**Date:** 2026-08-03  
**Status:** Approved through issue #19 and the maintainer's autonomous-development mandate

## 1. Purpose

LifeOS needs a control loop that keeps engineering activity aligned with buyer-visible product value rather than repository activity alone. The loop runs hourly, inspects repository and GitHub evidence, updates one living commercial-readiness issue, removes gaps whose evidence is complete, and squash-merges only pull requests that satisfy every review and security gate.

The stated 20-billion-dollar sale target is treated as an uncompromising quality bar, not a valuation promise. The loop records verifiable capability maturity, operating risk, customer impact, acquisition impact, and evidence. It never invents market evidence or claims a guaranteed sale price.

## 2. Product Gap Model

A versioned capability manifest is the source of truth for the product outcomes a sophisticated user or acquirer expects. Initial coverage includes:

- secure onboarding and Google/GitHub identity;
- durable goal, project, task, habit, and review data;
- a complete Today planning and completion loop;
- guided daily planning, shutdown, and weekly review;
- calendar time blocking, capture, search, recurrence, and reminders;
- mobile/PWA, accessibility, and localization;
- data export, deletion, and portability;
- observability, service objectives, backup, restore, and production deployment;
- license, privacy, terms, and contribution readiness;
- integrations, plugins, MCP, and auditable AI proposals.

Each capability carries an opaque dotted identifier, buyer-facing outcome, target maturity, impact scores, effort, dependencies, an optional GitHub issue reference, and evidence probes. GitHub issue and pull-request numbers remain external references; they are never reused as LifeOS internal identifiers.

## 3. Evidence and Maturity

Maturity levels are ordered as:

1. `missing`
2. `prototype`
3. `usable`
4. `production`
5. `differentiated`

Evidence probes are exact repository checks:

- `exists`: a bounded regular file exists;
- `contains`: a bounded regular file contains an exact contract string;
- `not_contains`: a bounded regular file no longer contains an identified placeholder or unsafe production dependency.

Every probe declares one of four kinds: `implementation`, `test`, `workflow`, or `documentation`. Documentation paths cannot satisfy implementation, test, or workflow evidence. This prevents aspirational documents from inflating product maturity.

The audit computes the highest fully supported maturity level. A gap disappears as soon as evidence supports its target; no stale checklist entry survives merely because it was previously open.

## 4. Gap Prioritization

The deterministic priority score combines:

- customer impact;
- security and reliability risk;
- acquisition impact;
- number of downstream capabilities blocked;
- maturity distance to target;
- estimated implementation effort as a modest penalty.

The score is intended to order engineering work, not estimate company value. Identical inputs always produce identical output.

## 5. GitHub Snapshot Boundary

A bounded GitHub client contacts only `https://api.github.com`, rejects redirects, enforces response limits and timeouts, and sends credentials only through the Authorization header. The retained snapshot includes only:

- repository and commit references;
- pull-request title and external number;
- head/base state and base distance;
- review state without review bodies;
- unresolved-thread count;
- workflow names and conclusions;
- commit-status contexts and states;
- issue titles, external numbers, states, and labels.

Provider credentials, OAuth material, session tokens, raw comments, raw review bodies, and arbitrary API response fields are not retained.

## 6. Safe Pull-Request Drain

A pull request is merge eligible only when all conditions hold:

- open, non-draft, same-repository head;
- base branch is `main` and the head is not behind it;
- author association is `OWNER`, `MEMBER`, or `COLLABORATOR`;
- GitHub reports it mergeable with a clean state;
- no latest review is `CHANGES_REQUESTED`;
- no unresolved review thread exists;
- `CI`, `SAST Semgrep`, `Security Scan`, `AppGuardrail`, and `Commercial Readiness` are completed successfully for the exact head SHA;
- `CodeRabbit` is successful for the exact head SHA.

Immediately before mutation, the loop re-fetches the pull request, all review evidence, all checks, and the exact head SHA. It uses GitHub's squash-merge endpoint with the expected SHA. It never uses an admin override, force push, merge commit, or branch-protection bypass.

## 7. Living Readiness Issue

One automation-owned issue is identified by:

```text
<!-- life-os-commercial-readiness-loop:v1 -->
```

The issue contains the evidence commit and timestamp, weighted maturity, highest-impact unresolved gaps, tracking issue references, and concise PR blocker categories. Untrusted titles and labels are redacted and Markdown/HTML escaped. Duplicate marker issues are closed as duplicates while the lowest-numbered issue remains canonical.

## 8. Hourly Workflow

The `Commercial Readiness` GitHub Actions workflow runs:

- on pull requests to validate the loop without writes;
- on pushes to `main` to refresh evidence and the living issue;
- at minute 23 of every hour;
- by manual dispatch.

Jobs are split by permission:

1. **audit** — read-only GitHub permissions; creates JSON and Markdown evidence and a dry-run PR drain;
2. **publish** — issue write permission only on non-PR default-branch runs;
3. **drain** — contents and pull-request write permissions only for scheduled or manual default-branch runs.

All external Actions are pinned to full commit SHAs. Evidence is retained for seven days. Concurrency prevents overlapping runs for the same ref or pull request.

## 9. Security Properties

- No numeric or sequential LifeOS internal IDs are introduced.
- Filesystem probes reject traversal, symlinks, non-files, and oversized input.
- GitHub JSON and repository manifests are schema-validated and bounded.
- Error messages do not echo upstream bodies or credentials.
- Generated issue text redacts token-like values and unsafe URI schemes.
- Fork pull requests receive no write path.
- Merge mode also verifies the GitHub event and protected default branch inside the Node CLI.
- AppGuardrail remains a required blocking workflow and no exclusion is added for this feature.

## 10. Verification

The package uses Node 22 built-ins and `node:test`. Tests cover malformed manifests, duplicate IDs, dependency cycles, evidence-kind confusion, gap addition/removal, deterministic ranking, filesystem boundaries, unsafe PR states, latest-review semantics, stale heads, GitHub response boundaries, duplicate issue prevention, redaction, Markdown escaping, dry-run behavior, pre-merge rechecks, schedule, permissions, action pinning, retention, and workflow merge restrictions.

## 11. Initial Buyer-Visible Findings

The initial manifest deliberately exposes current product reality:

- the web interface is still a static shell;
- planning is wired to in-memory persistence;
- habit and review services are health-only;
- production OAuth callbacks are not wired;
- calendar, reminders, search, PWA, accessibility, portability, observability, recovery, deployment, legal, integration, and auditable-AI capabilities remain incomplete.

Issue #18 is expected to remain the highest-priority unblocked production slice after the AppGuardrail gate and this control loop are merged.
