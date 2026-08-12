#!/usr/bin/env bash
set -Eeuo pipefail

branch='feat/review-data-rights-contributor-v1'
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git fetch --no-tags origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  "+refs/heads/$branch:refs/remotes/origin/$branch"
test "$(git rev-parse "origin/$branch")" = "$GITHUB_SHA"
test "$(git rev-parse origin/main)" = "$EXPECTED_MAIN"
git merge --no-edit --no-ff origin/main

corepack enable
pnpm install --frozen-lockfile

set +e
pnpm --filter @life-os/review-service exec vitest run \
  src/review-data-rights-receipt-scope.integration.test.ts \
  --no-file-parallelism --coverage.enabled=false \
  --reporter=json --outputFile="$RUNNER_TEMP/review-receipt-red.json" \
  >"$RUNNER_TEMP/review-receipt-red.log" 2>&1
red_status="$?"
set -e
cat "$RUNNER_TEMP/review-receipt-red.log"
test "$red_status" -ne 0
python3 - <<'PY'
import json
import os
from pathlib import Path

expected = 'allows the same idempotency key to be isolated across workspaces'
report_path = Path(os.environ['RUNNER_TEMP']) / 'review-receipt-red.json'
report = json.loads(report_path.read_text(encoding='utf-8'))
matching = []
for file_result in report.get('testResults', []):
    for assertion in file_result.get('assertionResults', []):
        name = ' '.join(
            str(assertion.get(field, ''))
            for field in ('fullName', 'title', 'ancestorTitles')
        )
        if expected in name:
            matching.append(assertion.get('status'))
if matching != ['failed']:
    raise SystemExit(f'unexpected RED assertion evidence: {matching!r}')
PY
grep -F 'Review erasure idempotency authority conflicts' \
  "$RUNNER_TEMP/review-receipt-red.log"

python3 - <<'PY'
from pathlib import Path

migration_path = Path(
    'apps/review-service/migrations/0002_data_rights_erasure_receipt.sql'
)
migration = migration_path.read_text(encoding='utf-8')
if migration.count('PRIMARY KEY (idempotency_key)') != 1:
    raise SystemExit('unexpected Review receipt primary-key shape')
migration = migration.replace(
    'PRIMARY KEY (idempotency_key)',
    'PRIMARY KEY (workspace_id, idempotency_key)',
    1,
)
migration_path.write_text(migration, encoding='utf-8')

source_path = Path('apps/review-service/src/review-data-rights.ts')
source = source_path.read_text(encoding='utf-8')
old_query = """         FROM guided_review.data_rights_erasure_receipt
         WHERE idempotency_key = $1`,
        [idempotencyKey],
"""
new_query = """         FROM guided_review.data_rights_erasure_receipt
         WHERE workspace_id = $1
           AND idempotency_key = $2`,
        [workspaceId, idempotencyKey],
"""
if source.count(old_query) != 1:
    raise SystemExit('unexpected Review receipt lookup shape')
source = source.replace(old_query, new_query, 1)
source_path.write_text(source, encoding='utf-8')

test_path = Path('apps/review-service/src/review-data-rights.test.ts')
tests = test_path.read_text(encoding='utf-8')
receipt_interface = """interface ReceiptRow {
  idempotency_key: string;
  workspace_id: string;
  requested_by_user_id: string;
  request_id: string;
  erased_records: number;
  receipt_sha256: string;
}

"""
receipt_helper = receipt_interface + """function receiptKey(
  workspaceId: string,
  idempotencyKey: string,
): string {
  return `${workspaceId}:${idempotencyKey}`;
}

"""
if tests.count(receipt_interface) != 1:
    raise SystemExit('unexpected Review receipt fixture interface')
tests = tests.replace(receipt_interface, receipt_helper, 1)

old_lookup = """    if (text.includes('FROM guided_review.data_rights_erasure_receipt')) {
      const idempotencyKey = String(values[0]);
      const receipt = this.receipts.get(idempotencyKey);
      return { rows: receipt ? ([receipt] as Row[]) : [] };
    }
"""
new_lookup = """    if (text.includes('FROM guided_review.data_rights_erasure_receipt')) {
      const workspaceId = String(values[0]);
      const idempotencyKey = String(values[1]);
      const receipt = this.receipts.get(
        receiptKey(workspaceId, idempotencyKey),
      );
      return { rows: receipt ? ([receipt] as Row[]) : [] };
    }
"""
if tests.count(old_lookup) != 1:
    raise SystemExit('unexpected Review receipt fixture lookup')
tests = tests.replace(old_lookup, new_lookup, 1)

old_store = """      this.receipts.set(String(idempotencyKey), {
        idempotency_key: String(idempotencyKey),
        workspace_id: String(workspaceId),
"""
new_store = """      this.receipts.set(receiptKey(String(workspaceId), String(idempotencyKey)), {
        idempotency_key: String(idempotencyKey),
        workspace_id: String(workspaceId),
"""
if tests.count(old_store) != 1:
    raise SystemExit('unexpected Review receipt fixture storage')
tests = tests.replace(old_store, new_store, 1)
test_path.write_text(tests, encoding='utf-8')
PY

pnpm exec prettier --single-quote --write \
  apps/review-service/src/review-data-rights.ts \
  apps/review-service/src/review-data-rights.test.ts \
  apps/review-service/src/review-data-rights-receipt-scope.integration.test.ts

git diff --check

pnpm --filter @life-os/review-service exec vitest run \
  src/review-data-rights-receipt-scope.integration.test.ts \
  src/review-data-rights.integration.test.ts \
  src/review-data-rights.test.ts \
  --no-file-parallelism --coverage.enabled=false
pnpm --filter @life-os/review-service run lint
pnpm --filter @life-os/review-service run typecheck
pnpm --filter @life-os/review-service run test
pnpm --filter @life-os/review-service run build

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
git diff --check

git rm \
  .github/scripts/repair-review-receipt-scope.sh \
  .github/workflows/finalize-review-receipt-scope.yml \
  .github/workflows/repair-review-data-rights-receipt-scope.yml \
  .github/workflows/run-review-receipt-repair.yml

actual="$(git status --short | awk '{print $2}' | LC_ALL=C sort)"
expected="$(printf '%s\n' \
  '.github/scripts/repair-review-receipt-scope.sh' \
  '.github/workflows/finalize-review-receipt-scope.yml' \
  '.github/workflows/repair-review-data-rights-receipt-scope.yml' \
  '.github/workflows/run-review-receipt-repair.yml' \
  'apps/review-service/migrations/0002_data_rights_erasure_receipt.sql' \
  'apps/review-service/src/review-data-rights-receipt-scope.integration.test.ts' \
  'apps/review-service/src/review-data-rights.test.ts' \
  'apps/review-service/src/review-data-rights.ts' \
  | LC_ALL=C sort)"
test "$actual" = "$expected"

git add \
  apps/review-service/migrations/0002_data_rights_erasure_receipt.sql \
  apps/review-service/src/review-data-rights-receipt-scope.integration.test.ts \
  apps/review-service/src/review-data-rights.test.ts \
  apps/review-service/src/review-data-rights.ts

git diff --cached --check
git commit -m 'fix(review): scope erasure receipts by workspace'
git fetch --no-tags origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  "+refs/heads/$branch:refs/remotes/origin/$branch"
test "$(git rev-parse "origin/$branch")" = "$GITHUB_SHA"
test "$(git rev-parse origin/main)" = "$EXPECTED_MAIN"
git merge-base --is-ancestor origin/main HEAD
git rev-parse HEAD >"$RUNNER_TEMP/review-receipt-ready-sha"
