# Changelog

All notable changes to LifeOS are documented in this file.

## Unreleased

### Changed

- Production contextual-orchestrator proposal requests now explicitly use adaptive `auto` mode and avoid provider-native structured-output passthrough, allowing the orchestration plane to meet the quality requirement and then minimize known cost while LifeOS retains strict fail-closed proposal validation.

### Added

- Durable PostgreSQL plugin-installation authority with opaque UUIDv4 installation/workspace/installer identity, exact manifest digests, normalized explicit grants, bounded conflict replay, and atomic revocation evidence in the service-owned `plugin_integration` schema.
- An authenticated calendar-connection disconnect application and optional hosted HTTP composition boundary that derives workspace and requesting-user authority only from the signed `life-os.calendar-user.v1` context and returns credential-free local revocation evidence.
- A durable PostgreSQL data-rights request ledger with workspace-scoped idempotency, immutable request and terminal receipt digests, one-way completion state, and real integration evidence that erasure receipts survive removal of the source workspace and user.
- Migration `0006_data_rights_request_ledger.sql` for the service-owned identity ledger, retaining only bounded opaque authority references and digest/status/timestamp evidence rather than exported personal payloads.
- An hourly and manually dispatchable NVIDIA NIM live-conformance harness that pins contextual-orchestrator to an exact reviewed commit, compares strong single-route reasoning with bounded conducted workflows, and retains only validated credential-free quality, safety, orchestration, usage, and ablation evidence.
- A versioned, immutable AI proposal quality evaluator that separates production validity, semantic operation conformance, evidence grounding, benign utility, forbidden-text leakage, and prompt-injection resistance across realistic English, Korean, temporal, empty-context, completed-item, and adversarial fixtures.
- An explicit `contextual-orchestrator` proposal-model mode with bounded OpenAI-compatible transport, strict structured output, model provenance, and an independent local rule-based default.
- Executable AI-service JSDoc and exact 100% statement, branch, function, and line coverage gates, with an operator-facing governance assurance boundary.
- Tenant-safe durable planning search across goals, projects, and tasks, with Unicode-normalized exact, prefix, and whole-token matching.
- An authenticated same-origin planning-search boundary that signs the session-derived workspace context and forwards no browser credential to planning-service.
- An accessible quick-capture and search surface that keeps browser-local Today drafts visibly separate from durable workspace records.
- Complete English and Korean message catalogs, a persisted keyboard-operable language selector, localized live-region announcements, and accessibility browser journeys for the Today action loop.
- A bounded notification scheduler with IANA time-zone quiet hours, per-local-day fatigue limits, tenant-scoped atomic claims, idempotent delivery keys, and credential-free retry outcomes.
- Durable PostgreSQL reminder occurrences, expiring worker claims, immutable scheduler outcomes, and an idempotent in-app inbox in the independent `notification_service` schema.
- A bounded notification runtime that composes one PostgreSQL pool, the reminder repository, the in-app gateway, and the scheduler with exactly-once pool shutdown.
- A production AI runtime that persists every inert proposal before returning it and exposes tenant-scoped proposal evidence and append-only accept/reject decision history.
- Replay-safe AI proposal decisions bound to the exact workspace, actor, proposal revision digest, UUIDv4 idempotency key, and decision timestamp.
- An authenticated same-origin AI proposal boundary that derives workspace and actor identity from the active session, signs the exact upstream method and path, and never forwards browser credentials to AI service.

### Fixed

- Commercial Readiness workflow evidence now remains bound to the exact pull request as well as its head SHA, so a newer same-head run from a different base/PR cannot satisfy another PR's merge gate.
- Commercial Readiness merge automation now fails closed when GitHub mergeability-state evidence is missing or outside the currently understood state set, so malformed or newly introduced states cannot become merge-eligible by omission.
- AppGuardrail path filtering now treats `**.md` as the repository-wide Markdown ignore for pull-request and protected-main push events, so nested documentation-only changes do not allocate a scanner runner while source-bearing changes still trigger the gate.
- LifeOS-owned pull-request workflows now listen for `converted_to_draft`; the existing same-PR concurrency key can cancel superseded ready-PR work while job-level Draft guards keep the cancellation run off hosted runners.
- Commercial Readiness now ignores malformed decisive review evidence with a blank reviewer identity or invalid submission timestamp, so malformed approvals cannot satisfy the merge gate.
- Commercial Readiness merge automation now requires an approval bound by GitHub review `commit_id` to the exact pull-request head; stale, missing, or malformed approval bindings cannot satisfy `missing-approval` or replace a current change request in the per-reviewer decisive state.
- The public Gateway Today endpoint now fails explicitly with bounded `today_composition_unavailable` problem details instead of returning fabricated successful composition data while authenticated Planning/Habit integration is absent; issue #163 remains open for the real composition path.
- Data-rights request-ID and idempotency collisions now resolve through stable credential-free domain conflicts instead of exposing raw PostgreSQL uniqueness errors, including ambiguous dual-collision evidence.
- The OpenCode development loop now prevents project settings from overriding its pinned offline NVIDIA model, records catalog failures accurately, parses the accepted candidate's exact Compose file outside the model account, and requires digest-pinned PostgreSQL queries plus NATS JetStream probes in pull-request CI.
- Live contextual-orchestrator responses now classify successful empty bodies as evaluation failures, emit exactly one terminal observation, canonicalize retained timestamps safely, and preserve null metric denominators instead of fabricating deltas.
- Stale AI proposal revision conflicts now belong to the technology-independent audit domain while the PostgreSQL adapter preserves its compatibility export.
- Planning search now normalizes browser query text and prevents stale or unmounted requests from replacing the latest visible result state.
- Reminder fatigue deferral now crosses long IANA offset fallbacks and next-day quiet hours without abandoning the claimed occurrence.
- Notification workers now recover expired claims and exact delivery replays without creating duplicate inbox messages.
- Notification batches now isolate delivery-count persistence failures, issue a distinct token for each claim attempt, share concurrent shutdown work, and emit bounded credential-free PostgreSQL failure classifications.

### Security

- Habit create/list/occurrence/completion routes now reject a bare client-selected `x-workspace-id` authority and require the short-lived signed `life-os.workspace.v1` gateway context before domain access.
- Plugin installation lookup, conflict replay, and revocation now carry authenticated workspace and installing-user authority through the PostgreSQL boundary; the durable record contains no plaintext plugin secret, token, credential, or password material.
- Calendar local disconnect never accepts client-selected ownership as authority, never reads provider secret handles, revalidates durable revocation evidence against the signed workspace+user context, and maps absent or differently owned connections to the same public not-found result.
- Goal, project, and task create/list routes now reject bare client-selected `x-workspace-id` authority and require the same short-lived signed `life-os.workspace.v1` context used by planning search and durable Today.
- The data-rights request ledger keeps personal export payloads out of durable audit rows and normalizes primary-key/idempotency collisions before dependency errors can escape the service boundary.
- The commercial-development model account no longer performs Docker commands, never receives Docker-socket authority, and cannot trigger provider-wide model discovery through the credential bridge.
- The scheduled live-model harness uses only `NVIDIA_NIM_API_KEY`, seeds it through the encrypted contextual-orchestrator credential registry, installs hash-locked dependencies from an exact commit, confines LifeOS traffic to loopback, allowlists NVIDIA NIM egress, and excludes provider credentials, prompts, responses, traces, and hidden reasoning from retained artifacts.
- Proposal quality reports now discard nested model failures and response bodies, normalize labeled sentinel checks, expose no provider credential or mutation dependency, and measure prompt-injection resistance together with benign utility instead of rewarding blanket refusal.
- External proposal generation now accepts only one credential-free HTTPS orchestrator origin, stops responses at 65536 bytes, enforces a bounded abort timeout, supplies no tools, treats planning context as untrusted data, and exposes only sanitized failures.
- AI gateway service-context authentication now carries an integrity-protected key identifier, signs only with one active key, verifies one explicitly selected active or previous key during a bounded overlap, and rejects retired identifiers immediately without trial verification.
- Planning-search upstream responses are stopped at a fixed byte limit before they can be fully buffered by the web boundary.
- Notification persistence stores SHA-256 idempotency digests instead of raw delivery keys, validates every untrusted row, and keeps all SQL tenant-scoped and parameterized.
- The AI production boundary rejects direct client-selected ownership headers, verifies a short-lived HMAC-SHA-256 context bound to workspace, actor, HTTP method, and exact path, returns credential-free problem details, and exposes no proposal apply or execution route.
- The AI web boundary consumes and bounds identity-session response streams exactly once, avoiding unbounded buffering from cloning an untrusted streamed response.
