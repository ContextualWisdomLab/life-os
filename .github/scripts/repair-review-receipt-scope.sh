#!/usr/bin/env bash
set -Eeuo pipefail

branch='feat/review-data-rights-contributor-v1'
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git fetch --no-tags origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  "+refs/heads/$branch:refs/remotes/origin/$branch"
test "$(git rev-parse origin/$branch)" = "$GITHUB_SHA"
git merge --no-edit --no-ff origin/main

corepack enable
pnpm install --frozen-lockfile

set +e
pnpm --filter @life-os/review-service exec vitest run \
  src/review-data-rights-receipt-scope.integration.test.ts \
  --no-file-parallelism --coverage.enabled=false \
  >"$RUNNER_TEMP/review-receipt-red.log" 2>&1
red_status="$?"
set -e
cat "$RUNNER_TEMP/review-receipt-red.log"
test "$red_status" -ne 0
grep -F 'allows the same idempotency key to be isolated across workspaces' \
  "$RUNNER_TEMP/review-receipt-red.log"
grep -F 'Review erasure idempotency authority conflicts' \
  "$RUNNER_TEMP/review-receipt-red.log"

python3 - <<'PY'
from pathlib import Path

migration_path = Path(
    'apps/review-service/migrations/0002_data_rights_erasure_receipt.sql'
)
migration = migration_path.read_text(encoding='utf-8')
old_primary = 'PRIMARY KEY (idempotency_key)'
new_primary = 'PRIMARY KEY (workspace_id, idempotency_key)'
if migration.count(old_primary) != 1:
    raise SystemExit('unexpected Review receipt primary-key shape')
migration = migration.replace(old_primary, new_primary, 1)
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
PY

pnpm exec prettier --single-quote --write \
  apps/review-service/src/review-data-rights.ts \
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
  .github/workflows/repair-review-data-rights-receipt-scope.yml \
  .github/workflows/run-review-receipt-repair.yml

git diff --check
actual="$(git status --short | awk '{print $2}' | LC_ALL=C sort)"
expected="$(printf '%s\n' \
  '.github/scripts/repair-review-receipt-scope.sh' \
  '.github/workflows/repair-review-data-rights-receipt-scope.yml' \
  '.github/workflows/run-review-receipt-repair.yml' \
  'apps/review-service/migrations/0002_data_rights_erasure_receipt.sql' \
  'apps/review-service/src/review-data-rights-receipt-scope.integration.test.ts' \
  'apps/review-service/src/review-data-rights.ts' \
  | LC_ALL=C sort)"
test "$actual" = "$expected"

git add \
  apps/review-service/migrations/0002_data_rights_erasure_receipt.sql \
  apps/review-service/src/review-data-rights-receipt-scope.integration.test.ts \
  apps/review-service/src/review-data-rights.ts

git commit -m 'fix(review): scope erasure receipts by workspace'
git fetch --no-tags origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  "+refs/heads/$branch:refs/remotes/origin/$branch"
test "$(git rev-parse origin/$branch)" = "$GITHUB_SHA"
git merge-base --is-ancestor origin/main HEAD
git push origin "HEAD:refs/heads/$branch"
