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

migration_roots=(
  'identity|IDENTITY_DATABASE_URL|apps/identity-service/migrations'
  'planning|PLANNING_DATABASE_URL|apps/planning-service/migrations'
  'habit|HABIT_DATABASE_URL|apps/habit-service/migrations'
  'ai|AI_DATABASE_URL|apps/ai-service/migrations'
  'review|REVIEW_DATABASE_URL|apps/review-service/migrations'
)

apply_service_migrations() {
  local service_name="$1"
  local database_url_name="$2"
  local migration_directory="$3"
  local database_url="${!database_url_name:-}"
  local migration_file migration_name migration_sha existing_sha
  local -a migration_files=()

  shopt -s nullglob
  migration_files=("${migration_directory}"/*.sql)
  shopt -u nullglob

  ((${#migration_files[@]} > 0)) || return 0
  [[ -n "${database_url}" ]] || fail "${database_url_name}_required"
  [[ "${database_url}" != *$'\n'* && "${database_url}" != *$'\r'* ]] ||
    fail "${database_url_name}_invalid"
  [[ "${database_url}" == postgres://* || "${database_url}" == postgresql://* ]] ||
    fail "${database_url_name}_invalid_scheme"

  PGDATABASE="${database_url}" psql \
    --no-psqlrc \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    <<SQL
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('life-os-migration-ledger', 0));
CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA};
CREATE TABLE IF NOT EXISTS ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
  service_name text NOT NULL,
  migration_name text NOT NULL,
  migration_sha256 character(64) NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (service_name, migration_name),
  CONSTRAINT migration_sha256_format CHECK (migration_sha256 ~ '^[0-9a-f]{64}$')
);
COMMIT;
SQL

  for migration_file in "${migration_files[@]}"; do
    migration_name="$(basename "${migration_file}")"
    migration_sha="$(sha256sum "${migration_file}" | awk '{print $1}')"
    [[ "${migration_sha}" =~ ^[0-9a-f]{64}$ ]] || fail 'migration_digest_invalid'

    existing_sha="$(
      PGDATABASE="${database_url}" psql \
        --no-psqlrc \
        --no-password \
        --tuples-only \
        --no-align \
        --set=ON_ERROR_STOP=1 \
        --set=service_name="${service_name}" \
        --set=migration_name="${migration_name}" \
        --command="SELECT migration_sha256 FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} WHERE service_name = :'service_name' AND migration_name = :'migration_name';"
    )"
    existing_sha="${existing_sha//$'\n'/}"

    if [[ -n "${existing_sha}" ]]; then
      [[ "${existing_sha}" == "${migration_sha}" ]] ||
        fail "migration_digest_changed:${service_name}:${migration_name}"
      printf 'migration_status=already_applied service=%s migration=%s\n' \
        "${service_name}" "${migration_name}"
      continue
    fi

    {
      printf 'BEGIN;\n'
      printf "SELECT pg_advisory_xact_lock(hashtextextended('life-os-migrations:%s', 0));\n" \
        "${service_name}"
      cat "${migration_file}"
      printf '\n'
      printf "INSERT INTO %s.%s (service_name, migration_name, migration_sha256) VALUES (:'service_name', :'migration_name', :'migration_sha256');\n" \
        "${MIGRATION_SCHEMA}" "${MIGRATION_TABLE}"
      printf 'COMMIT;\n'
    } | PGDATABASE="${database_url}" psql \
      --no-psqlrc \
      --no-password \
      --set=ON_ERROR_STOP=1 \
      --set=service_name="${service_name}" \
      --set=migration_name="${migration_name}" \
      --set=migration_sha256="${migration_sha}"

    printf 'migration_status=applied service=%s migration=%s\n' \
      "${service_name}" "${migration_name}"
  done
}

for migration_root in "${migration_roots[@]}"; do
  IFS='|' read -r service_name database_url_name migration_directory <<<"${migration_root}"
  apply_service_migrations \
    "${service_name}" \
    "${database_url_name}" \
    "${migration_directory}"
done

printf 'migration_status=completed\n'
