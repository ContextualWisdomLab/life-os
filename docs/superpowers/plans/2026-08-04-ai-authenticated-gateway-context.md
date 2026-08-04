# Authenticated AI Proposal Gateway Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route browser AI proposal and audit requests through identity-derived, short-lived, method-and-path-bound HMAC service context so clients cannot select workspace or actor ownership.

**Architecture:** Add a framework-neutral verifier in AI service and a server-only Next.js BFF client modeled on the merged planning-search boundary. Explicit route handlers delegate to the BFF; the BFF introspects identity-service, derives workspace/user UUIDs, signs the exact AI method/path, and calls AI service without forwarding the browser cookie.

**Tech Stack:** TypeScript 5.9, Node.js 22 crypto/fetch/Web Streams, NestJS, Next.js 15 App Router, `tsx --test`, Vitest, PostgreSQL integration tests, GitHub Actions.

## Global Constraints

- Service-context HMAC payload is exactly `life-os.ai-context.v1\n<workspace_id>\n<actor_id>\n<issued_at>\n<METHOD>\n<path>` with no trailing LF.
- Secret length is 32–4096 UTF-8 bytes; context age is at most 60 seconds; future skew is at most 5 seconds.
- Workspace, actor, proposal, and idempotency identifiers remain UUIDv4.
- Browser cookies are sent only to identity-service and never AI service.
- No apply, execute, command-bus, or user-data mutation capability is added.
- All new helpers require explanatory docstrings and 100% statement, branch, and function coverage.
- Database schema and object naming remain unchanged; any new database object would require two-or-more-word snake_case.
- Next.js 15 dynamic route `params` are asynchronous and must be awaited.
- All browser and dependency errors remain credential-free RFC 9457-compatible problems.

---

## File Structure

- Create `apps/ai-service/src/ai-http-boundary.ts`: service-context verification and AI HTTP problem mapping.
- Create `apps/ai-service/src/ai-http-boundary.test.ts`: complete verifier/error-mapping coverage.
- Modify `apps/ai-service/src/main.ts`: require verified context for every proposal/audit route.
- Modify `apps/ai-service/src/proposal-audit-http.integration.test.ts`: signed-context HTTP evidence and unsigned/replay rejection.
- Create `apps/web/app/ai-proposal-client.ts`: bounded identity introspection, signing, upstream forwarding, and response validation.
- Create `apps/web/app/ai-proposal-client.test.ts`: complete BFF coverage.
- Create `apps/web/app/api/ai/proposals/route.ts`: collection GET/POST.
- Create `apps/web/app/api/ai/proposals/[proposalId]/route.ts`: proposal GET.
- Create `apps/web/app/api/ai/proposals/[proposalId]/decisions/route.ts`: decision GET/POST.
- Create `apps/web/app/api/ai/proposals/routes.test.ts`: route delegation and asynchronous-params evidence.
- Modify `apps/web/package.json`: include new tests/files in lint/test.
- Modify root `package.json`: include every new file in formatting gate.
- Modify `.env.example`: add `AI_SERVICE_ORIGIN` and `AI_GATEWAY_CONTEXT_SECRET`.
- Modify `apps/ai-service/migrations/README.md`: document trusted proxy contract.
- Modify `CHANGELOG.md`: record the authenticated AI browser boundary.

---

### Task 1: AI Service Context Verifier — RED

**Files:**
- Create: `apps/ai-service/src/ai-http-boundary.test.ts`
- Test: `apps/ai-service/src/ai-http-boundary.test.ts`

**Interfaces:**
- Produces the wished-for signatures:
  - `requireTrustedAiContext(headers, secret, method, path, nowSeconds?): TrustedAiContext`
  - `mapAiHttpError(error): HttpException`
  - `TrustedAiContext { workspaceId: string; actorId: string }`

- [ ] **Step 1: Write the failing exact-signature test**

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { requireTrustedAiContext } from './ai-http-boundary';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const secret = '0123456789abcdef0123456789abcdef';
const issuedAt = '1785806400';
const path = '/v1/proposals';

function signature(method: 'GET' | 'POST', targetPath = path): string {
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}\n${method}\n${targetPath}`,
      'utf8',
    )
    .digest('base64url');
}

describe('trusted AI service context', () => {
  it('accepts the exact fresh method-and-path-bound context', () => {
    expect(
      requireTrustedAiContext(
        { workspaceId, actorId, issuedAt, signature: signature('POST') },
        secret,
        'POST',
        path,
        Number(issuedAt),
      ),
    ).toEqual({ workspaceId, actorId });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/ai-http-boundary.test.ts
```

Expected: FAIL because `./ai-http-boundary` does not exist.

- [ ] **Step 3: Add table-driven failing cases**

Add cases for:

```ts
it.each([
  ['GET', path, signature('POST')],
  ['POST', '/v1/proposals/33333333-3333-4333-8333-333333333333', signature('POST')],
])('rejects method/path replay: %s %s', (method, targetPath, forged) => {
  expect(() =>
    requireTrustedAiContext(
      { workspaceId, actorId, issuedAt, signature: forged },
      secret,
      method,
      targetPath,
      Number(issuedAt),
    ),
  ).toThrow();
});
```

Also cover missing/short/oversized secret, malformed workspace/actor UUID, malformed timestamp/signature, stale `issuedAt - 61`, future `issuedAt + 6`, unsupported method, noncanonical path, and wrong secret.

- [ ] **Step 4: Add failing problem-mapping assertions**

Assert verifier failures produce:

```ts
{
  type: 'about:blank',
  title: 'Trusted gateway context is invalid',
  status: 401,
  code: 'invalid_gateway_context',
}
```

and missing/invalid secret produces `503 gateway_context_unavailable`.

- [ ] **Step 5: Commit RED tests**

```bash
git add apps/ai-service/src/ai-http-boundary.test.ts
git commit -m "test(ai): define authenticated service context contract"
```

---

### Task 2: AI Service Context Verifier — GREEN

**Files:**
- Create: `apps/ai-service/src/ai-http-boundary.ts`
- Test: `apps/ai-service/src/ai-http-boundary.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TrustedAiContextHeaders {
  workspaceId: unknown;
  actorId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

export interface TrustedAiContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

export function requireTrustedAiContext(
  headers: TrustedAiContextHeaders,
  secret: unknown,
  method: unknown,
  path: unknown,
  nowSeconds?: number,
): TrustedAiContext;
```

- [ ] **Step 1: Implement bounded canonical validation**

Use:

```ts
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PATH_PATTERN = /^\/v1\/proposals(?:\/[0-9a-f-]{36}(?:\/decisions)?)?$/u;
const ALLOWED_METHODS = new Set(['GET', 'POST']);
```

Reject control characters, paths over 256 code units, noncanonical UUID path segments, and methods not exactly uppercase `GET`/`POST`.

- [ ] **Step 2: Implement exact HMAC verification**

```ts
const expected = createHmac('sha256', secret)
  .update(
    `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}\n${method}\n${path}`,
    'utf8',
  )
  .digest();
const actual = Buffer.from(signature, 'base64url');
if (!timingSafeEqual(actual, expected)) invalidGatewayContext();
```

- [ ] **Step 3: Run focused tests and verify GREEN**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/ai-http-boundary.test.ts
```

Expected: PASS with 100% local coverage after adding all boundary cases.

- [ ] **Step 4: Run AI package tests**

```bash
pnpm --filter @life-os/ai-service test
pnpm --filter @life-os/ai-service typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit verifier**

```bash
git add apps/ai-service/src/ai-http-boundary.ts apps/ai-service/src/ai-http-boundary.test.ts
git commit -m "feat(ai): verify signed gateway context"
```

---

### Task 3: Enforce Verified Context in AI Controllers

**Files:**
- Modify: `apps/ai-service/src/main.ts`
- Modify: `apps/ai-service/src/proposal-audit-http.integration.test.ts`
- Test: `apps/ai-service/src/proposal-audit-http.integration.test.ts`

**Interfaces:**
- Consumes `requireTrustedAiContext` from Task 2.
- Produces controller methods that use only `TrustedAiContext.workspaceId/actorId`.

- [ ] **Step 1: Write failing unsigned-context integration assertions**

Replace direct ownership headers in the integration request helper with optional service-context headers. Add:

```ts
const unsigned = await requestJson(
  address,
  'POST',
  '/v1/proposals',
  proposalRequest(taskId),
  { 'x-workspace-id': workspaceId, 'x-actor-id': actorId },
);
expect(unsigned).toMatchObject({
  statusCode: 401,
  body: { code: 'invalid_gateway_context' },
});
```

Add method replay and path replay cases using otherwise valid signatures.

- [ ] **Step 2: Run integration test and verify RED**

```bash
AI_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/life_os_test \
AI_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/life_os_test \
pnpm --filter @life-os/ai-service exec vitest run src/proposal-audit-http.integration.test.ts
```

Expected: FAIL because legacy ownership headers still authorize requests.

- [ ] **Step 3: Add a controller context helper**

In `main.ts`, add a private helper or small function:

```ts
function trustedContext(
  headers: { workspaceId: unknown; actorId: unknown; issuedAt: unknown; signature: unknown },
  method: 'GET' | 'POST',
  path: string,
): TrustedAiContext {
  return requireTrustedAiContext(
    headers,
    process.env.AI_GATEWAY_CONTEXT_SECRET,
    method,
    path,
  );
}
```

Each route must build its canonical path from its validated UUID parameter. Remove reads of `x-workspace-id` and `x-actor-id`.

- [ ] **Step 4: Preserve proposal/decision semantics**

Generation passes `context.workspaceId`; decision append passes `context.actorId`. Reads ignore the actor only after signature verification. No application API changes are needed.

- [ ] **Step 5: Run integration and package tests**

Run the commands from Step 2 plus:

```bash
pnpm --filter @life-os/ai-service test
pnpm --filter @life-os/ai-service typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit controller enforcement**

```bash
git add apps/ai-service/src/main.ts apps/ai-service/src/proposal-audit-http.integration.test.ts
git commit -m "fix(ai): reject unsigned ownership context"
```

---

### Task 4: Same-Origin AI BFF — RED

**Files:**
- Create: `apps/web/app/ai-proposal-client.test.ts`
- Test: `apps/web/app/ai-proposal-client.test.ts`

**Interfaces:**
- Produces wished-for API:

```ts
export type AiProposalRoute =
  | { kind: 'collection' }
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'decisions'; proposalId: string };

export function createAiContextHeaders(...): Readonly<Record<string, string>>;
export async function handleAiProposalRequest(...): Promise<Response>;
```

- [ ] **Step 1: Write failing identity-derived context test**

Use a deterministic fetcher that records two calls. Identity returns:

```ts
{
  sessionId: randomUUID(),
  userId: actorId,
  workspaceId,
  createdAt: '2026-08-04T00:00:00.000Z',
  expiresAt: '2026-08-05T00:00:00.000Z',
}
```

Assert AI request headers contain signed workspace/actor context, no `cookie`, and preserve a generated correlation ID shared with identity-service.

- [ ] **Step 2: Add failing route/method signature cases**

Assert `createAiContextHeaders` signs:

```ts
life-os.ai-context.v1
<workspace>
<actor>
<issuedAt>
POST
/v1/proposals/<proposalId>/decisions
```

- [ ] **Step 3: Add failing validation/bounds tests**

Cover:

- unknown browser methods;
- malformed proposal UUID;
- unknown JSON keys including `workspaceId`/`actorId`;
- wrong media type, absent body, malformed JSON, >32 KiB request;
- cookie >4 KiB or CR/LF;
- invalid/credentialed service origins;
- missing/short/oversized secret;
- identity 401 vs dependency failures;
- malformed identity user/workspace UUIDs;
- AI response wrong media type, >32 KiB stream, invalid JSON/shape;
- AI 404/409 safe-code pass-through and all other failures mapped to 503.

- [ ] **Step 4: Run test and verify RED**

```bash
pnpm --filter @life-os/web exec tsx --test app/ai-proposal-client.test.ts
```

Expected: FAIL because `ai-proposal-client.ts` does not exist.

- [ ] **Step 5: Commit RED tests**

```bash
git add apps/web/app/ai-proposal-client.test.ts
git commit -m "test(web): define authenticated AI proposal BFF"
```

---

### Task 5: Same-Origin AI BFF — GREEN

**Files:**
- Create: `apps/web/app/ai-proposal-client.ts`
- Test: `apps/web/app/ai-proposal-client.test.ts`

**Interfaces:**
- Produces `handleAiProposalRequest` used by route handlers.

- [ ] **Step 1: Implement fixed configuration and session parsing**

Reuse the planning BFF rules for `requireServiceOrigin`, cookie bounds, media types, response streams, timeout, and UUID/timestamp validation. Parse both `workspaceId` and `userId`; reject extra ownership sources from browser input.

- [ ] **Step 2: Implement exact route translation**

```ts
function upstreamTarget(route: AiProposalRoute, method: string): URLPath {
  // collection -> /v1/proposals
  // proposal -> /v1/proposals/<uuid>
  // decisions -> /v1/proposals/<uuid>/decisions
}
```

Permit only GET/POST combinations declared in the design.

- [ ] **Step 3: Implement canonical HMAC headers**

Create the exact four service headers and bind uppercase method + exact path. Use `AI_GATEWAY_CONTEXT_SECRET` only server-side.

- [ ] **Step 4: Implement bounded forwarding**

Identity request receives browser cookie and correlation ID. AI request receives no cookie, no authorization header, and only canonical body/service headers. Use `cache: 'no-store'`, `redirect: 'error'`, and `AbortSignal.timeout(3000)`.

- [ ] **Step 5: Implement bounded response mapping**

Return 200/201 payloads after strict validation. Pass through only the explicitly safe AI problem codes/statuses: 404 `proposal_not_found`, 409 `stale_proposal`, 409 `idempotency_conflict`. Map all malformed/unexpected dependency results to 503.

- [ ] **Step 6: Run focused tests and coverage**

```bash
pnpm --filter @life-os/web exec tsx --test --experimental-test-coverage app/ai-proposal-client.test.ts
```

Expected: PASS and 100% statement/branch/function coverage for the new module.

- [ ] **Step 7: Commit BFF implementation**

```bash
git add apps/web/app/ai-proposal-client.ts apps/web/app/ai-proposal-client.test.ts
git commit -m "feat(web): add authenticated AI proposal BFF"
```

---

### Task 6: Next.js Route Handlers

**Files:**
- Create: `apps/web/app/api/ai/proposals/route.ts`
- Create: `apps/web/app/api/ai/proposals/[proposalId]/route.ts`
- Create: `apps/web/app/api/ai/proposals/[proposalId]/decisions/route.ts`
- Create: `apps/web/app/api/ai/proposals/routes.test.ts`

**Interfaces:**
- Consumes `handleAiProposalRequest` and `AiProposalRoute`.
- Produces browser routes from the design.

- [ ] **Step 1: Write route delegation tests**

Test exported handlers with deterministic `Request` objects and asynchronous params:

```ts
const response = await proposalGET(request, {
  params: Promise.resolve({ proposalId }),
});
```

Verify the correct route descriptor and method reach the shared handler. Use an injectable exported route factory if direct fetch/environment control would otherwise be difficult.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @life-os/web exec tsx --test app/api/ai/proposals/routes.test.ts
```

Expected: FAIL because route modules do not exist.

- [ ] **Step 3: Implement collection route**

```ts
export async function GET(request: Request): Promise<Response> {
  return handleAiProposalRequest(request, process.env, { kind: 'collection' });
}

export async function POST(request: Request): Promise<Response> {
  return handleAiProposalRequest(request, process.env, { kind: 'collection' });
}
```

- [ ] **Step 4: Implement dynamic routes with awaited params**

```ts
export async function GET(
  request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
): Promise<Response> {
  const { proposalId } = await params;
  return handleAiProposalRequest(request, process.env, {
    kind: 'proposal',
    proposalId,
  });
}
```

Use the same Next.js 15 pattern for decisions GET/POST.

- [ ] **Step 5: Run route and web tests**

```bash
pnpm --filter @life-os/web exec tsx --test app/api/ai/proposals/routes.test.ts
pnpm --filter @life-os/web test
pnpm --filter @life-os/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit routes**

```bash
git add apps/web/app/api/ai apps/web/app/api/ai/proposals/routes.test.ts
git commit -m "feat(web): expose same-origin AI audit routes"
```

---

### Task 7: Package Gates, Operations, and Changelog

**Files:**
- Modify: `apps/web/package.json`
- Modify: root `package.json`
- Modify: `.env.example`
- Modify: `apps/ai-service/migrations/README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces complete CI discoverability and operator configuration.

- [ ] **Step 1: Add new web files to lint/test commands**

Include `app/ai-proposal-client.ts`, its test, all three route files, and route tests. Do not remove existing explicit targets in this feature slice.

- [ ] **Step 2: Add new files to root formatting gate**

Include the AI boundary, tests, BFF files, routes, spec, and plan.

- [ ] **Step 3: Add environment variables**

```dotenv
AI_SERVICE_ORIGIN=http://127.0.0.1:4105
AI_GATEWAY_CONTEXT_SECRET=replace-with-at-least-32-random-bytes
```

- [ ] **Step 4: Document trusted-proxy contract**

Document header names, payload order, age/skew, method/path binding, secret ownership, rotation boundary, and prohibition on direct public AI-service exposure.

- [ ] **Step 5: Update Unreleased changelog**

Add a concise entry describing authenticated same-origin AI proposal/audit routing and signed service context.

- [ ] **Step 6: Run complete repository validation**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all PASS with no warnings treated as failures.

- [ ] **Step 7: Commit docs and gates**

```bash
git add .env.example CHANGELOG.md package.json apps/web/package.json apps/ai-service/migrations/README.md docs/superpowers
git commit -m "docs(ai): document authenticated gateway context"
```

---

### Task 8: Pull Request Review and Merge Loop

**Files:**
- No new production files unless review identifies a valid defect.

**Interfaces:**
- Produces a merged exact-head PR and zero open PRs before the next slice.

- [ ] **Step 1: Create draft PR**

Title:

```text
feat(ai): authenticate proposal audit through signed gateway context
```

Body must summarize the boundary, list validation evidence, close #108, and reference #46/#21/#105.

- [ ] **Step 2: Inspect every exact-head workflow**

Required: CI, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit.

- [ ] **Step 3: Review human, CodeRabbit, and security feedback**

Verify each finding against current code. For valid findings: add a failing regression test, verify RED, implement the minimal fix, verify GREEN, and push. Explain and defer only non-actionable or out-of-scope suggestions.

- [ ] **Step 4: Resolve addressed threads**

Resolve only after the exact fix is present and validated on the current head.

- [ ] **Step 5: Mark ready and recheck exact head**

Confirm no base drift, no unresolved actionable thread, no requested changes, all required workflows successful, and CodeRabbit status successful.

- [ ] **Step 6: Squash merge with expected head SHA**

```text
feat(ai): authenticate proposal audit through signed gateway context (#<PR>)
```

- [ ] **Step 7: Confirm open PR count and continue**

Search `is:open` in `ContextualWisdomLab/life-os`. If zero, select the next issue-backed buyer gap and begin a new bounded design/plan/PR cycle.
