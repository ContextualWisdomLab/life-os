#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

readonly REQUIRED_CONFIRMATION='apply-forward-only'
readonly MIGRATION_SCHEMA='life_os_deployment'
readonly MIGRATION_TABLE='schema_migrations'
readonly SERVICE_WRITER='infra/kubernetes/write-pg-service.py'

fail() {
  printf 'migration_error=%s\n' "$1" >&2
  exit 1
}

[[ "${LIFE_OS_MIGRATION_CONFIRMATION:-}" == "${REQUIRED_CONFIRMATION}" ]] ||
  fail 'explicit_confirmation_required'
command -v psql >/dev/null 2>&1 || fail 'psql_not_available'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum_not_available'
command -v mktemp >/dev/null 2>&1 || fail 'mktemp_not_available'
command -v python >/dev/null 2>&1 || fail 'python_not_available'
[[ -f "${SERVICE_WRITER}" ]] || fail 'service_writer_not_available'

migration_roots=(
  'identity|IDENTITY_DATABASE_URL|apps/identity-service/migrations'
  'planning|PLANNING_DATABASE_URL|apps/planning-service/migrations'
  'habit|HABIT_DATABASE_URL|apps/habit-service/migrations'
  'ai|AI_DATABASE_URL|apps/ai-service/migrations'
  'review|REVIEW_DATABASE_URL|apps/review-service/migrations'
)

legacy_reconciliation_sql() {
  local service_name="$1"
  local migration_name="$2"

  case "${service_name}:${migration_name}" in
    'identity:0004_oauth_secret_key_versions.sql')
      cat <<'SQL'
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'identity'
        AND table_name = 'oauth_transactions'
        AND column_name = 'code_verifier_key_version'
        AND is_nullable = 'NO'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'identity'
        AND table_name = 'oauth_transactions'
        AND column_name = 'nonce_key_version'
    )
    AND (
      SELECT COUNT(*) = 4
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation_row
        ON relation_row.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'identity'
        AND relation_row.relname = 'oauth_transactions'
        AND constraint_row.conname IN (
          'oauth_verifier_key_version_format',
          'oauth_nonce_key_version_format',
          'oauth_verifier_ciphertext_minimum_length',
          'oauth_nonce_ciphertext_minimum_length'
        )
    ) AS legacy_migration_state_matches
  \gset
SQL
      ;;
    'identity:0004_session_authentication_age.sql'|'identity:0005_finalize_session_authentication_age.sql')
      cat <<'SQL'
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'identity'
        AND table_name = 'sessions'
        AND column_name = 'authenticated_at'
        AND is_nullable = 'NO'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation_row
        ON relation_row.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'identity'
        AND relation_row.relname = 'sessions'
        AND constraint_row.conname = 'sessions_authentication_not_after_creation'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation_row
        ON relation_row.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'identity'
        AND relation_row.relname = 'sessions'
        AND constraint_row.conname = 'sessions_authentication_present'
    ) AS legacy_migration_state_matches
  \gset
SQL
      ;;
    'identity:0005_opaque_uuid_v4_identifiers.sql')
      cat <<'SQL'
  SELECT (
    SELECT COUNT(*) = 5
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation_row
      ON relation_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace_row
      ON namespace_row.oid = relation_row.relnamespace
    WHERE namespace_row.nspname = 'identity'
      AND (
        (relation_row.relname = 'users' AND constraint_row.conname = 'users_id_uuid_v4')
        OR (
          relation_row.relname = 'external_identities'
          AND constraint_row.conname = 'external_identities_id_uuid_v4'
        )
        OR (
          relation_row.relname = 'workspaces'
          AND constraint_row.conname = 'workspaces_id_uuid_v4'
        )
        OR (
          relation_row.relname = 'sessions'
          AND constraint_row.conname = 'sessions_id_uuid_v4'
        )
        OR (
          relation_row.relname = 'oauth_transactions'
          AND constraint_row.conname = 'oauth_transactions_id_uuid_v4'
        )
      )
  ) AS legacy_migration_state_matches
  \gset
SQL
      ;;
    *)
      cat <<'SQL'
  SELECT false AS legacy_migration_state_matches
  \gset
SQL
      ;;
  esac
}

append_migration_command() {
  local command_file="$1"
  local service_name="$2"
  local migration_file="$3"
  local migration_name="$4"
  local migration_sequence="$5"
  local migration_sha="$6"
  local reconciliation_sql
  reconciliation_sql="$(legacy_reconciliation_sql "${service_name}" "${migration_name}")"

  cat >>"${command_file}" <<SQL
\\set service_name '${service_name}'
\\set migration_name '${migration_name}'
\\set migration_sequence '${migration_sequence}'
\\set migration_sha256 '${migration_sha}'
SELECT
  EXISTS (
    SELECT 1
    FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
    WHERE service_name = :'service_name'
      AND migration_name = :'migration_name'
  ) AS migration_exists,
  COALESCE(
    (
      SELECT migration_sha256 = :'migration_sha256'
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
        AND migration_name = :'migration_name'
    ),
    false
  ) AS migration_digest_matches,
  COALESCE(
    (
      SELECT migration_status = 'applied'
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
        AND migration_name = :'migration_name'
    ),
    false
  ) AS migration_is_applied,
  COALESCE(
    (
      SELECT MAX(migration_name COLLATE "C")
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
    ),
    ''
  ) AS latest_migration_name
\\gset
\\if :migration_exists
  \\if :migration_digest_matches
    \\if :migration_is_applied
      \\echo migration_status=already_applied service=:service_name migration=:migration_name
    \\else
      \\echo migration_error=incomplete_migration_requires_reconciliation service=:service_name migration=:migration_name
      \\quit 1
    \\endif
  \\else
    \\echo migration_error=migration_digest_changed service=:service_name migration=:migration_name
    \\quit 1
  \\endif
\\else
  SELECT (:'migration_name' COLLATE "C") > (:'latest_migration_name' COLLATE "C")
    AS migration_name_is_forward
  \\gset
  \\if :migration_name_is_forward
    INSERT INTO ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
      service_name,
      migration_name,
      migration_sequence,
      migration_sha256,
      migration_status
    ) VALUES (
      :'service_name',
      :'migration_name',
      (:'migration_sequence')::integer,
      :'migration_sha256',
      'applying'
    );
    \\echo migration_status=applying service=:service_name migration=:migration_name
    \\i ${migration_file}
    UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
    SET migration_status = 'applied',
        applied_at = clock_timestamp()
    WHERE service_name = :'service_name'
      AND migration_name = :'migration_name'
      AND migration_sha256 = :'migration_sha256'
      AND migration_status = 'applying';
    \\echo migration_status=applied service=:service_name migration=:migration_name
  \\else
${reconciliation_sql}
    \\if :legacy_migration_state_matches
      INSERT INTO ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
        service_name,
        migration_name,
        migration_sequence,
        migration_sha256,
        migration_status,
        applied_at,
        migration_reconciled
      ) VALUES (
        :'service_name',
        :'migration_name',
        (:'migration_sequence')::integer,
        :'migration_sha256',
        'applied',
        clock_timestamp(),
        true
      );
      \\echo migration_status=reconciled service=:service_name migration=:migration_name
    \\else
      \\echo migration_error=migration_name_not_forward service=:service_name migration=:migration_name latest=:latest_migration_name
      \\quit 1
    \\endif
  \\endif
\\endif
SQL
}

apply_service_migrations() {
  local service_name="$1"
  local database_url_name="$2"
  local migration_directory="$3"
  local migration_file migration_name migration_sequence migration_sha
  local workspace command_file service_file
  local -a migration_files=()

  [[ "${service_name}" =~ ^[a-z][a-z0-9_]*$ ]] || fail 'service_name_invalid'
  shopt -s nullglob
  migration_files=("${migration_directory}"/*.sql)
  shopt -u nullglob

  ((${#migration_files[@]} > 0)) || return 0
  [[ -n "${!database_url_name:-}" ]] || fail "${database_url_name}_required"

  workspace="$(mktemp -d)"
  command_file="${workspace}/migration_commands.psql"
  service_file="${workspace}/pg_service.conf"
  if ! python "${SERVICE_WRITER}" \
    --environment-variable "${database_url_name}" \
    --service-name "${service_name}" \
    --output "${service_file}"; then
    rm -rf "${workspace}"
    fail "database_service_configuration_failed:${service_name}"
  fi
  unset "${database_url_name}"

  cat >"${command_file}" <<SQL
\\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('life-os-migrations:${service_name}', 0));
CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA};
CREATE TABLE IF NOT EXISTS ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
  service_name text NOT NULL,
  migration_name text NOT NULL,
  migration_sequence integer NOT NULL,
  migration_sha256 character(64) NOT NULL,
  migration_status text NOT NULL,
  applied_at timestamp with time zone,
  migration_reconciled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (service_name, migration_name),
  CONSTRAINT migration_sequence_range CHECK (
    migration_sequence BETWEEN 0 AND 9999
  ),
  CONSTRAINT migration_sha256_format CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_status_valid CHECK (migration_status IN ('applying', 'applied')),
  CONSTRAINT migration_applied_at_consistent CHECK (
    (migration_status = 'applying' AND applied_at IS NULL)
    OR (migration_status = 'applied' AND applied_at IS NOT NULL)
  )
);
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ADD COLUMN IF NOT EXISTS migration_sequence integer;
UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
SET migration_sequence = substring(migration_name FROM '^[0-9]{4}')::integer
WHERE migration_sequence IS NULL;
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ALTER COLUMN migration_sequence SET NOT NULL;
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ADD COLUMN IF NOT EXISTS migration_reconciled boolean;
UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
SET migration_reconciled = false
WHERE migration_reconciled IS NULL;
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ALTER COLUMN migration_reconciled SET DEFAULT false,
  ALTER COLUMN migration_reconciled SET NOT NULL;
DROP INDEX IF EXISTS ${MIGRATION_SCHEMA}.schema_migrations_service_sequence_unique;
SQL

  for migration_file in "${migration_files[@]}"; do
    migration_name="$(basename "${migration_file}")"
    [[ "${migration_name}" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]] || {
      rm -rf "${workspace}"
      fail "migration_name_invalid:${service_name}:${migration_name}"
    }
    [[ "${migration_file}" =~ ^[A-Za-z0-9_./-]+$ ]] || {
      rm -rf "${workspace}"
      fail "migration_path_invalid:${service_name}:${migration_name}"
    }
    migration_sequence="${migration_name%%_*}"
    migration_sha="$(sha256sum "${migration_file}" | awk '{print $1}')"
    [[ "${migration_sha}" =~ ^[0-9a-f]{64}$ ]] || {
      rm -rf "${workspace}"
      fail "migration_digest_invalid:${service_name}:${migration_name}"
    }
    append_migration_command \
      "${command_file}" \
      "${service_name}" \
      "${migration_file}" \
      "${migration_name}" \
      "${migration_sequence}" \
      "${migration_sha}"
  done

  cat >>"${command_file}" <<SQL
SELECT pg_advisory_unlock(hashtextextended('life-os-migrations:${service_name}', 0));
SQL

  if ! PGSERVICEFILE="${service_file}" PGSERVICE="${service_name}" psql \
    --no-psqlrc \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --file="${command_file}"; then
    rm -rf "${workspace}"
    fail "service_migration_failed:${service_name}"
  fi
  rm -rf "${workspace}"
}

for migration_root in "${migration_roots[@]}"; do
  IFS='|' read -r service_name database_url_name migration_directory <<<"${migration_root}"
  apply_service_migrations \
    "${service_name}" \
    "${database_url_name}" \
    "${migration_directory}"
done

printf 'migration_status=completed\n'
