# Contextual-orchestrator OpenCode commercial development loop implementation plan

> **Execution method:** Test-driven development, exact-head verification, and normal pull-request review. The deterministic selector, prompt builder, diff validator, receipt validator, gateway boundary, and workflow contracts are proved before model-assisted mutation is eligible for merge.

**Goal:** Provide one hourly/manual OpenCode development lane that routes exclusively through contextual-orchestrator `orchestrator/free`, creates at most one bounded same-repository draft pull request, and leaves deterministic audit/review/merge authority independent of model availability.

**Architecture:** `@life-os/commercial-development-agent` owns LifeOS policy. GitHub Actions gathers bounded repository evidence, creates an isolated UUIDv4 worktree, runs an exact pinned OpenCode process without GitHub or upstream provider credentials, connects it only to an authenticated loopback contextual-orchestrator gateway, validates the candidate, and then lets a separate trusted step commit and open a draft PR. Provider discovery and credentials remain contextual-orchestrator authority.

**Dependency rule:** Do not consume a mutable contextual-orchestrator branch head in production. The gateway-auth prerequisite must land upstream, be published as an immutable reviewed release, and then be consumed by exact released identity before this PR can become Ready.

## Global constraints

- Never use `COPILOT_GITHUB_TOKEN`.
- Do not repurpose review-agent credentials.
- Provider credentials (`BYTEZ_API_KEY`, `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_API_KEY_SUB`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`) are scoped only to contextual-orchestrator gateway bootstrap.
- `opencode_model` receives only the per-run loopback gateway token and the virtual `orchestrator/free` model label.
- Do not hard-code a provider, provider group, paid fallback, or direct provider URL in LifeOS model execution.
- Do not persist or replay raw provider/gateway logs, prompts, responses, hidden reasoning, source diffs, or credentials.
- Do not terminate reasoning, streaming, or tool-call work solely because a fixed request/chunk/model wall timer elapsed. A separate workflow-level administrative timeout may remain.
- No force-push, self-approval, admin bypass, workflow self-modification, release mutation, deployment mutation, or direct `main` push.

## Completed implementation sequence

### 1. Deterministic policy package

Keep issue selection, prompt construction, UUIDv4 validation, diff limits, object-type rejection, prohibited-content rules, credential-free receipt serialization, and exact-base lease checks in repository-owned deterministic code. Maintain 100% package coverage under the repository policy.

### 2. Reviewed OpenCode identity

Install exact `opencode-ai@1.18.9` from the lockfile. Verify it only through `verify-opencode-identity.mjs`, which runs the binary without `NODE_OPTIONS`, requires exact version equality, detects `--pure` from combined stdout/stderr, and validates the reviewed `run --help` contract. Regression tests must reject direct version/help/run-help probes in workflow YAML.

### 3. Contextual-orchestrator gateway boundary

Replace the obsolete direct NVIDIA bridge with `contextual_orchestrator_gateway/orchestrator/free`. Disable OpenCode project-local configuration discovery, sharing, auto-update, and model-catalog refresh. Register and whitelist only the virtual route.

Create separate `opencode_model` and `opencode_gateway` system users. During model execution, UID-based firewall rules permit the model account to reach only the configured IPv4 loopback gateway port and deny IPv6/other egress. Provider credentials are never injected into the model account.

### 4. Sidecar bootstrap safety

`lifeos_contextual_orchestrator_sidecar.sh` must:

- require a per-run gateway token and at least one governed provider credential;
- validate decimal port syntax, strip leading zeros, and enforce 1024–65535 before arithmetic;
- install contextual-orchestrator from an immutable reviewed release identity once available;
- fail closed when gateway authentication cannot be established;
- expose no credential/provider body in operator diagnostics.

Current state: decimal-port and missing-provider execution regressions are implemented, but immutable released gateway-auth support is still an upstream prerequisite.

### 5. Timeout and diagnostic authority

Remove provider `timeout` and `chunkTimeout` settings from the OpenCode route and remove the model-level GNU `timeout` wrapper. Preserve the job-level administrative timeout as a distinct runner bound. Discard raw sidecar stdout/stderr during bootstrap and retain only stable credential-free classifications in the receipt.

### 6. Candidate isolation and verification

Copy reviewed source into a disposable workspace without `.git`. Deny external-directory, web fetch/search, and arbitrary Bash authority except reviewed verification commands. After the model returns, the trusted boundary inventories candidate paths without following symlinks, rejects binary/symlink/submodule/oversized/prohibited changes, and validates the exact base before materialization.

Run format, lint, typecheck, test, and build as the unprivileged model account with no Docker socket. Parse the accepted Compose file later through a trusted Docker step. Ordinary credential-free PR CI performs runtime PostgreSQL/NATS health evidence and unconditional teardown.

### 7. Remote mutation lease

Immediately before remote mutation re-read protected `main`, open-PR count, selected issue digest, and remote automation branch identity. If any lease changed, perform no remote mutation. Otherwise create one commit, push one UUIDv4 automation branch without force, and open one draft PR.

### 8. Documentation and traceability

Keep `ARCHITECTURE.md`, `CHANGELOG.md`, this plan, the companion design, the operations runbook, and the APA 7 research basis aligned with the contextual-orchestrator route. Historical direct-NVIDIA behavior remains available through Git history rather than as active instructions.

## Remaining dependency-ordered work

1. In contextual-orchestrator owner scope, repair and verify gateway token registration for `--auth-token-key CONTEXTUAL_ORCHESTRATOR_TOKEN`.
2. Publish an immutable contextual-orchestrator release containing that behavior, including SBOM/provenance/rollback evidence required by its owner policy.
3. In LifeOS, bump the sidecar to that exact immutable release identity. Do not use the newer protected head directly.
4. Add/execute an authenticated integration test that starts the real released gateway, proves `orchestrator/free` accepts the per-run token, and proves upstream provider credentials never enter `opencode_model`.
5. Run exact-head package coverage, action/workflow validation, CI, security, AppGuardrail, Commercial Readiness, OpenCode/Noema/Strix, and review-thread gates.
6. Only after all checks are terminal GREEN and the live approval requirement is satisfied may the PR move from Draft to Ready and merge normally.

## Acceptance evidence

The final unchanged head must prove:

- exact OpenCode identity and direct-help regression coverage;
- gateway-only provider-secret mapping;
- no direct-provider route/configuration;
- decimal-port normalization and range failures;
- no raw gateway diagnostic retention/replay;
- no fixed request/chunk/model elapsed-time termination;
- authenticated real-gateway execution against an immutable contextual-orchestrator release;
- diff/path/object/credential/base-lease failure cases;
- credential-free receipt serialization;
- 100% package coverage and repository docstring/edge-case policy;
- all live required checks and review threads resolved without bypass.

If the immutable upstream release is unavailable, the correct result is a Draft blocked on the owner release path, not a mutable dependency pin or weakened acceptance gate.
