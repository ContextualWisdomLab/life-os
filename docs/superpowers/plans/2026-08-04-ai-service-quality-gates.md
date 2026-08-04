# AI Service Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce 100% executable documentation and code coverage for the production AI proposal-audit service while correcting the remaining domain-layer dependency and recording current governance standards.

**Architecture:** Keep `apps/ai-service` independently deployable. Add package-local Vitest/V8 and TypeScript-AST documentation gates, move stale-revision semantics into the audit domain with a compatibility re-export from the PostgreSQL adapter, then add only realistic tests needed to exercise every production path. Record the assurance boundary in operator documentation and the commercial-readiness manifest.

**Tech Stack:** TypeScript 5.9, NestJS 11, Vitest 3.2, `@vitest/coverage-v8`, TypeScript compiler API, PostgreSQL 16, pnpm/Turborepo, GitHub Actions.

## Global Constraints

- Production coverage thresholds are exactly 100% for statements, branches, functions, and lines.
- No production source file or branch may be excluded from coverage.
- JSDoc applies to production top-level declarations and class/interface members, not test files or nested callbacks.
- Database object identifiers remain multi-word `snake_case`.
- The AI service receives no generic user-data mutation dependency.
- Standards references use APA 7th formatting.
- The exact PR head must pass CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all actionable review threads.

---

### Task 1: Add executable 100% coverage and JSDoc gates

**Files:**

- Create: `apps/ai-service/vitest.config.ts`
- Create: `apps/ai-service/src/docstring-coverage.test.ts`
- Modify: `apps/ai-service/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: package-local Vitest configuration with exact 100% thresholds.
- Produces: a deterministic TypeScript-AST documentation test over production declarations.

- [ ] **Step 1: Add the package-local coverage configuration**

```ts
import { defineConfig } from 'vitest/config';

/** Complete AI-service production coverage gate. */
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: [['text', { maxCols: 1_000 }], 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
```

- [ ] **Step 2: Add the failing production-docstring contract**

Use the TypeScript compiler API to collect undocumented top-level functions, classes, interfaces, type aliases, callable variables, constructors, methods, method signatures, and callable class/interface properties. Exclude `*.test.ts` and nested expression declarations. Assert the resulting list equals `[]`.

- [ ] **Step 3: Update the AI package scripts and dependencies**

```json
{
  "scripts": {
    "lint": "tsc --noEmit && prettier --single-quote --check package.json tsconfig.json vitest.config.ts \"src/**/*.ts\" ../../docs/operations/ai-proposal-audit-assurance.md ../../docs/superpowers/specs/2026-08-04-ai-service-quality-gates-design.md ../../docs/superpowers/plans/2026-08-04-ai-service-quality-gates.md",
    "test": "vitest run --no-file-parallelism --coverage"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.2.4"
  }
}
```

- [ ] **Step 4: Add the new deterministic paths to the root formatting gate**

Append the AI Vitest config, JSDoc test, operator note, design, and plan paths to `format:check` without broadening the repository-wide scope in this slice.

- [ ] **Step 5: Run the AI gate and capture the expected failures**

Run: `pnpm --filter @life-os/ai-service test`

Expected: FAIL with exact uncovered production lines/branches and any undocumented declarations; no configuration or missing-provider error.

- [ ] **Step 6: Commit the gate before repairing coverage**

```bash
git add apps/ai-service/package.json apps/ai-service/vitest.config.ts apps/ai-service/src/docstring-coverage.test.ts package.json
git commit -m "test(ai): enforce complete coverage and documentation"
```

### Task 2: Restore domain-layer ownership of stale proposal revisions

**Files:**

- Modify: `apps/ai-service/src/proposal-audit-domain.ts`
- Modify: `apps/ai-service/src/postgres-proposal-audit-repository.ts`
- Modify: `apps/ai-service/src/proposal-audit-application.ts`
- Modify: `apps/ai-service/src/main.ts`
- Test: `apps/ai-service/src/proposal-audit-domain.test.ts`
- Test: `apps/ai-service/src/postgres-proposal-audit-repository.test.ts`

**Interfaces:**

- Produces: `ProposalDigestMismatchError` from `proposal-audit-domain.ts`.
- Preserves: `ProposalDigestMismatchError` re-export from `postgres-proposal-audit-repository.ts`.

- [ ] **Step 1: Add a failing domain-ownership test**

```ts
it('owns stale immutable revision semantics in the audit domain', () => {
  const error = new ProposalDigestMismatchError();
  expect(error).toMatchObject({
    name: 'ProposalDigestMismatchError',
    message: 'Proposal content digest does not match persisted evidence',
  });
});
```

- [ ] **Step 2: Move the error class into the domain**

```ts
/** Raised when a decision references a stale or unknown proposal digest. */
export class ProposalDigestMismatchError extends Error {
  constructor() {
    super('Proposal content digest does not match persisted evidence');
    this.name = 'ProposalDigestMismatchError';
  }
}
```

- [ ] **Step 3: Preserve repository compatibility**

Import the domain error into `postgres-proposal-audit-repository.ts` and add:

```ts
export { ProposalDigestMismatchError } from './proposal-audit-domain';
```

Remove the repository-local class definition. Update application and HTTP imports to point at the domain module.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @life-os/ai-service exec vitest run src/proposal-audit-domain.test.ts src/postgres-proposal-audit-repository.test.ts src/proposal-audit-application.test.ts --no-file-parallelism --coverage.enabled=false`

Expected: PASS.

- [ ] **Step 5: Commit the dependency correction**

```bash
git add apps/ai-service/src/proposal-audit-domain.ts apps/ai-service/src/proposal-audit-domain.test.ts apps/ai-service/src/postgres-proposal-audit-repository.ts apps/ai-service/src/proposal-audit-application.ts apps/ai-service/src/main.ts
git commit -m "refactor(ai): own stale revision semantics in domain"
```

### Task 3: Close every production coverage and documentation gap

**Files:**

- Modify tests under: `apps/ai-service/src/**/*.test.ts`
- Modify production JSDoc only where the executable contract identifies a missing declaration.

**Interfaces:**

- Consumes: exact coverage summary and undocumented-declaration list from Task 1.
- Produces: 100% statements, branches, functions, and lines with no production exclusions.

- [ ] **Step 1: Run the complete AI suite**

Run: `pnpm --filter @life-os/ai-service test`

Expected: FAIL only for concrete coverage/docstring gaps.

- [ ] **Step 2: Add realistic tests for each reported path**

Use existing deterministic seams and disposable PostgreSQL integration setup. Required scenarios include invalid clock values, malformed persistence rows, extra SQL rows, unknown error sanitization, pool shutdown concurrency/retry, stale decision digest, conflicting idempotency replay, tenant isolation, and unsupported apply/execute routes.

- [ ] **Step 3: Re-run until the coverage table is exact**

Run: `pnpm --filter @life-os/ai-service test`

Expected terminal table:

```text
All files | 100 | 100 | 100 | 100
```

- [ ] **Step 4: Run lint, typecheck, and build**

```bash
pnpm --filter @life-os/ai-service lint
pnpm --filter @life-os/ai-service typecheck
pnpm --filter @life-os/ai-service build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit complete evidence**

```bash
git add apps/ai-service/src apps/ai-service/package.json apps/ai-service/vitest.config.ts
git commit -m "test(ai): reach complete production coverage"
```

### Task 4: Record governance standards and commercial evidence

**Files:**

- Create: `docs/operations/ai-proposal-audit-assurance.md`
- Modify: `product/capabilities.json`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Produces: operator-facing control/limitation documentation with APA 7th references.
- Produces: `quality.ai-audit-assurance` commercial-readiness capability.

- [ ] **Step 1: Write the operator assurance note**

Document the inert proposal boundary, append-only evidence, human authorization separation, trusted-header assumption, failure sanitization, risk-review triggers, retention limitations, and exact verification commands.

- [ ] **Step 2: Add APA 7th references**

Use these exact entries:

```text
Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). Artificial intelligence risk management framework: Generative artificial intelligence profile (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

International Organization for Standardization. (2023a). Information technology—Artificial intelligence—Guidance on risk management (ISO/IEC 23894:2023). ISO.

International Organization for Standardization. (2023b). Information technology—Artificial intelligence—Management system (ISO/IEC 42001:2023). ISO.

Nottingham, M., Wilde, E., & Dalal, S. (2023). Problem details for HTTP APIs (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457
```

- [ ] **Step 3: Add the capability manifest entry**

Create `quality.ai-audit-assurance` with dependencies on `ai.auditable-proposals` and `automation.commercial-readiness-loop`; require implementation evidence, `vitest.config.ts`, `docstring-coverage.test.ts`, and the operator note for production maturity. Set `tracking_issue` to `107`.

- [ ] **Step 4: Update the changelog**

Under `Unreleased`, record the exact 100% AI-service coverage/JSDoc gate, the domain dependency correction, and governance-assurance documentation.

- [ ] **Step 5: Run commercial-readiness package tests**

Run: `pnpm --filter @life-os/commercial-readiness test`

Expected: PASS with the updated capability graph and no duplicate/unknown dependency.

- [ ] **Step 6: Commit documentation and evidence**

```bash
git add docs/operations/ai-proposal-audit-assurance.md product/capabilities.json CHANGELOG.md
git commit -m "docs(ai): record audit assurance standards"
```

### Task 5: Verify the exact head and open the PR

**Files:**

- No new source files beyond Tasks 1–4.

**Interfaces:**

- Produces: one reviewable PR that closes #107.

- [ ] **Step 1: Run complete local verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Expected: every command exits 0 and AI-service coverage reports 100/100/100/100.

- [ ] **Step 2: Push and open a non-draft PR**

Title: `test(ai): enforce complete audit assurance gates`

Body must summarize the exact coverage results, executable documentation contract, domain-layer correction, standards references, and deferred model-quality/execution scope. Include `Closes #107`.

- [ ] **Step 3: Drain review feedback**

For every exact head: inspect CodeRabbit/security/human review, fix still-valid findings, re-run all required workflows, resolve every actionable thread, and merge only when all required workflows plus CodeRabbit are successful.
