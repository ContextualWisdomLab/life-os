# Product-Technical Gap Baseline

## 2026-09-02 — Notification data-rights startup authentication / PR #198

### Exact failed evidence

- PR #198 head `a66a11ae9e86992778b8781f130d177b5ad2c65f` failed GitHub Advanced Security `Semgrep OSS` check run `99930190131` with one new finding: `generic.secrets.security.detected-generic-secret.detected-generic-secret` at `apps/notification-service/src/notification-http.test.ts:12`.
- The triggering test-first commit introduced a deterministic 32-character hexadecimal value assigned to `CONTEXT_SECRET`. It was a fixture rather than a production credential, but it was indistinguishable from hard-coded secret material to the repository's required scanner and therefore is not a finding to suppress.
- The same RED test established a separate product configuration defect: `bootstrapNotificationService` validated host and port and then constructed the durable runtime before verifying `NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET`. Missing or short authentication material could therefore allocate service-owned durable resources before startup failed at a later request boundary.

### Root-cause classification

Repository-owned test fixture plus startup fail-closed defect. Evidence did not indicate a provider/network transient, stale predecessor, missing permission, circular dependency, or expected governance failure. The scanner did what the security gate is intended to do.

### Repair

- Commit `053fa8929c91a7f15b37bb88b5fdf4221e825978` replaced the secret-like test literal with a composed non-secret fixture while retaining the RED startup contract.
- Commit `a24c344fbd55ff663753e3d41ae60b2520d524d2` validates that `NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET` is at least 32 UTF-8 bytes before creating the durable runtime, matching the lower-level data-rights authentication boundary and the test's exact fail-closed expectation.
- Commit `440cdd75f1f63e03dd38f34635a427baffd8cd77` documents the required Notification data-rights context secret in `.env.example`.
- No Semgrep rule, review requirement, coverage/security threshold, or branch protection was weakened or bypassed.

### Repair-transport incident

A temporary one-shot workflow added at `b4c49721f1c8e7be3e2500f9b23de4c59b90ea16` to automate the deterministic repair was rejected by GitHub Actions before job creation. Runs `33530792519` and `33530882479` both completed as failures with zero jobs, so no runner step or product test executed. Because the workflow was disposable repair transport rather than a product gate and the pre-job validation failure was exactly reproducible, it was removed at `da7dd12506fa512bb65010130d69c3f7ed43aa66` rather than weakened or treated as passing. No force push or rebase was used, and the concurrent fixture cleanup commit was preserved.

### Verification status

The current exact head after documentation changes must be evaluated only from checks attached to that exact SHA. Queued, pending, skipped, or predecessor evidence is not counted as passing. At the time of this record, newly triggered exact-head CI/security/review workflows were still queued or pending; a later run must re-fetch their terminal results before the PR is considered green.
