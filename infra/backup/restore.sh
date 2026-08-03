#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'restore_error=%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required_command_missing:$1"
}

[[ -n "${DATABASE_URL:-}" ]] || fail 'database_url_missing'
[[ -n "${BACKUP_ARCHIVE:-}" ]] || fail 'backup_archive_missing'
[[ "${LIFEOS_RESTORE_CONFIRMATION:-}" == 'restore-empty-database' ]] ||
  fail 'restore_confirmation_missing'
[[ "${BACKUP_ARCHIVE}" != *$'\n'* && "${BACKUP_ARCHIVE}" != *$'\r'* ]] ||
  fail 'backup_archive_invalid'
[[ -f "${BACKUP_ARCHIVE}" && ! -L "${BACKUP_ARCHIVE}" ]] ||
  fail 'backup_archive_invalid'

checksum_path="${BACKUP_ARCHIVE}.sha256"
[[ -f "${checksum_path}" && ! -L "${checksum_path}" ]] ||
  fail 'backup_checksum_missing'

require_command psql
require_command pg_restore
require_command sha256sum
require_command awk
require_command date
require_command tr

mapfile -t checksum_lines <"${checksum_path}"
[[ "${#checksum_lines[@]}" == '1' ]] || fail 'backup_checksum_manifest_invalid'
checksum_line="${checksum_lines[0]}"
[[ "${checksum_line}" =~ ^([0-9a-f]{64})[[:space:]][[:space:]]([^/]+)$ ]] ||
  fail 'backup_checksum_manifest_invalid'
expected_digest="${BASH_REMATCH[1]}"
manifest_archive_name="${BASH_REMATCH[2]}"
archive_name="${BACKUP_ARCHIVE##*/}"
[[ "${manifest_archive_name}" == "${archive_name}" ]] ||
  fail 'backup_checksum_archive_mismatch'
actual_digest="$(sha256sum "${BACKUP_ARCHIVE}" | awk '{print $1}')"
[[ "${actual_digest}" == "${expected_digest}" ]] || fail 'backup_checksum_mismatch'

pg_restore --list "${BACKUP_ARCHIVE}" >/dev/null || fail 'backup_archive_unreadable'

target_database="$({
  PGDATABASE="${DATABASE_URL}" psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command='SELECT current_database();'
} | tr -d '[:space:]')"
[[ -n "${target_database}" ]] || fail 'target_database_unknown'
case "${target_database}" in
  postgres | template0 | template1)
    fail 'target_database_protected'
    ;;
esac

user_relation_count="$({
  PGDATABASE="${DATABASE_URL}" psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT count(*) FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname !~ '^pg_toast' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');"
} | tr -d '[:space:]')"
[[ "${user_relation_count}" =~ ^[0-9]+$ ]] || fail 'target_database_probe_invalid'
[[ "${user_relation_count}" == '0' ]] || fail 'target_database_not_empty'

started_at="$(date +%s)"
PGDATABASE="${DATABASE_URL}" pg_restore \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${BACKUP_ARCHIVE}"
completed_at="$(date +%s)"
restore_duration_seconds="$((completed_at - started_at))"

printf 'restore_database=%s\n' "${target_database}"
printf 'restore_duration_seconds=%s\n' "${restore_duration_seconds}"
printf 'restore_status=completed\n'
