#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'backup_error=%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required_command_missing:$1"
}

[[ -n "${DATABASE_URL:-}" ]] || fail 'database_url_missing'
[[ -n "${BACKUP_DIRECTORY:-}" ]] || fail 'backup_directory_missing'
[[ "${BACKUP_DIRECTORY}" != "/" ]] || fail 'backup_directory_unsafe'
[[ "${BACKUP_DIRECTORY}" != *$'\n'* && "${BACKUP_DIRECTORY}" != *$'\r'* ]] ||
  fail 'backup_directory_invalid'
[[ ! -L "${BACKUP_DIRECTORY}" ]] || fail 'backup_directory_symlink'

require_command pg_dump
require_command pg_restore
require_command sha256sum
require_command awk
require_command date
require_command mktemp
require_command tr

mkdir -p -- "${BACKUP_DIRECTORY}"
chmod 700 -- "${BACKUP_DIRECTORY}"
[[ -d "${BACKUP_DIRECTORY}" && ! -L "${BACKUP_DIRECTORY}" ]] ||
  fail 'backup_directory_invalid'

backup_directory="$(cd -- "${BACKUP_DIRECTORY}" && pwd -P)"
temporary_directory="$(mktemp -d "${backup_directory}/.life-os-backup.XXXXXX")"
cleanup() {
  rm -rf -- "${temporary_directory}"
}
trap cleanup EXIT INT TERM

created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
file_timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
bundle_name="life-os-backup-${file_timestamp}"
bundle_path="${backup_directory}/${bundle_name}"
archive_name="life-os.dump"
checksum_name="${archive_name}.sha256"
metadata_name="${archive_name}.metadata"

[[ ! -e "${bundle_path}" ]] || fail 'backup_name_collision'

PGDATABASE="${DATABASE_URL}" pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="${temporary_directory}/${archive_name}"

[[ -s "${temporary_directory}/${archive_name}" ]] || fail 'backup_archive_empty'
pg_restore --list "${temporary_directory}/${archive_name}" >/dev/null

archive_digest="$(sha256sum "${temporary_directory}/${archive_name}" | awk '{print $1}')"
[[ "${archive_digest}" =~ ^[0-9a-f]{64}$ ]] || fail 'backup_checksum_invalid'
printf '%s  %s\n' \
  "${archive_digest}" \
  "${archive_name}" \
  >"${temporary_directory}/${checksum_name}"

pg_dump_version="$(pg_dump --version | tr -d '\r\n')"
printf 'schema=life-os.backup-metadata.v1\ncreated_at=%s\nformat=postgresql-custom\nsha256=%s\nclient=%s\n' \
  "${created_at}" \
  "${archive_digest}" \
  "${pg_dump_version}" \
  >"${temporary_directory}/${metadata_name}"

chmod 600 -- \
  "${temporary_directory}/${archive_name}" \
  "${temporary_directory}/${checksum_name}" \
  "${temporary_directory}/${metadata_name}"
chmod 700 -- "${temporary_directory}"
mv -- "${temporary_directory}" "${bundle_path}"

archive_path="${bundle_path}/${archive_name}"
checksum_path="${bundle_path}/${checksum_name}"
metadata_path="${bundle_path}/${metadata_name}"
printf 'backup_bundle=%s\n' "${bundle_path}"
printf 'backup_archive=%s\n' "${archive_path}"
printf 'backup_checksum=%s\n' "${checksum_path}"
printf 'backup_metadata=%s\n' "${metadata_path}"
