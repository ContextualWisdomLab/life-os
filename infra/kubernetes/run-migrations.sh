#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly REQUIRED_CONFIRMATION='apply-forward-only'
readonly MIGRATION_SCHEMA='life_os_deployment'
readonly MIGRATION_TABLE='schema_migrations'

fail() {
  printf 'migration_error=%s\n' "$1" >&2
  exit 1
}

[[ "${LIFE_OS_MIGRATION_CONFIRMATION:-}" == "${REQUIRED_CONFIRMATION}" ]] ||
  fail 'explicit_confirmation_required'
command -v psql >/dev/null 2>&1 || fail 'psql_not_available'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum_not_available'
command -v mktemp >/dev/null 2>&1 || fail 'mktemp_not_available'

migration_roots=(
  'identity|IDENTITY_DATABASE_URL|apps/identity-service/migrations'
  'planning|PLANNING_DATABASE_URL|apps/planning-service/migrations'
  'habit|HABIT_DATABASE_URL|apps/habit-service/migrations'
  'ai|AI_DATABASE_URL|apps/ai-service/migrations'
  'review|REVIEW_DATABASE_URL|apps/review-service/migrations'
)

append_migration_command() {
  local command_file="$1"
  local service_name="$2"
  local migration_file="$3"
  local migration_name="$4"
  local migration_sha="$5"

  cat >>"${command_file}" <<SQL
\\set service_name '${service_name}'
\\set migration_name '${migration_name}'
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
  ) AS migration_is_applied
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
  INSERT INTO ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
    service_name,
    migration_name,
    migration_sha256,
    migration_status
  ) VALUES (
    :'service_name',
    :'migration_name',
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
\\endif
SQL
}

apply_service_migrations() {
  local service_name="$1"
  local database_url_name="$2"
  local migration_directory="$3"
  local database_url="${!database_url_name:-}"
  local migration_file migration_name migration_sha command_file
  local -a migration_files=()

  [[ "${service_name}" =~ ^[a-z][a-z0-9_]*$ ]] || fail 'service_name_invalid'
  shopt -s nullglob
  migration_files=("${migration_directory}"/*.sql)
  shopt -u nullglob

  ((${#migration_files[@]} > 0)) || return 0
  [[ -n "${database_url}" ]] || fail "${database_url_name}_required"
  [[ "${database_url}" != *$'\n'* && "${database_url}" != *$'\r'* ]] ||
    fail "${database_url_name}_invalid"
  [[ "${database_url}" == postgres://* || "${database_url}" == postgresql://* ]] ||
    fail "${database_url_name}_invalid_scheme"

  command_file="$(mktemp)"
  cat >"${command_file}" <<SQL
\\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('life-os-migrations:${service_name}', 0));
CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA};
CREATE TABLE IF NOT EXISTS ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
  service_name text NOT NULL,
  migration_name text NOT NULL,
  migration_sha256 character(64) NOT NULL,
  migration_status text NOT NULL,
  applied_at timestamp with time zone,
  PRIMARY KEY (service_name, migration_name),
  CONSTRAINT migration_sha256_format CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_status_valid CHECK (migration_status IN ('applying', 'applied')),
  CONSTRAINT migration_applied_at_consistent CHECK (
    (migration_status = 'applying' AND applied_at IS NULL)
    OR (migration_status = 'applied' AND applied_at IS NOT NULL)
  )
);
SQL

  for migration_file in "${migration_files[@]}"; do
    migration_name="$(basename "${migration_file}")"
    [[ "${migration_name}" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]] || {
      rm -f "${command_file}"
      fail "migration_name_invalid:${service_name}:${migration_name}"
    }
    [[ "${migration_file}" =~ ^[A-Za-z0-9_./-]+$ ]] || {
      rm -f "${command_file}"
      fail "migration_path_invalid:${service_name}:${migration_name}"
    }
    migration_sha="$(sha256sum "${migration_file}" | awk '{print $1}')"
    [[ "${migration_sha}" =~ ^[0-9a-f]{64}$ ]] || {
      rm -f "${command_file}"
      fail "migration_digest_invalid:${service_name}:${migration_name}"
    }
    append_migration_command \
      "${command_file}" \
      "${service_name}" \
      "${migration_file}" \
      "${migration_name}" \
      "${migration_sha}"
  done

  cat >>"${command_file}" <<SQL
SELECT pg_advisory_unlock(hashtextextended('life-os-migrations:${service_name}', 0));
SQL

  if ! PGDATABASE="${database_url}" psql \
    --no-psqlrc \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --file="${command_file}"; then
    rm -f "${command_file}"
    fail "service_migration_failed:${service_name}"
  fi
  rm -f "${command_file}"
}

for migration_root in "${migration_roots[@]}"; do
  IFS='|' read -r service_name database_url_name migration_directory <<<"${migration_root}"
  apply_service_migrations \
    "${service_name}" \
    "${database_url_name}" \
    "${migration_directory}"
done

printf 'migration_status=completed\n'
