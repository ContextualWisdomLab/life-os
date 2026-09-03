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
        AND is_nullable = 'YES'
    )
    AND (
      SELECT
        COUNT(*) = 5
        AND bool_and(constraint_row.contype = 'c' AND constraint_row.convalidated)
        AND COUNT(*) FILTER (
          WHERE constraint_row.conname = 'oauth_verifier_key_version_format'
            AND position('code_verifier_key_version' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('A-Za-z0-9._-' in pg_get_constraintdef(constraint_row.oid)) > 0
        ) = 1
        AND COUNT(*) FILTER (
          WHERE constraint_row.conname = 'oauth_nonce_key_version_format'
            AND position('nonce_key_version' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('A-Za-z0-9._-' in pg_get_constraintdef(constraint_row.oid)) > 0
        ) = 1
        AND COUNT(*) FILTER (
          WHERE constraint_row.conname = 'oauth_verifier_ciphertext_minimum_length'
            AND position('code_verifier_ciphertext' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('28' in pg_get_constraintdef(constraint_row.oid)) > 0
        ) = 1
        AND COUNT(*) FILTER (
          WHERE constraint_row.conname = 'oauth_nonce_ciphertext_minimum_length'
            AND position('nonce_ciphertext' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('28' in pg_get_constraintdef(constraint_row.oid)) > 0
        ) = 1
        AND COUNT(*) FILTER (
          WHERE constraint_row.conname = 'oauth_nonce_encryption_metadata_by_provider'
            AND position('provider' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('google' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('github' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('nonce_ciphertext' in pg_get_constraintdef(constraint_row.oid)) > 0
            AND position('nonce_key_version' in pg_get_constraintdef(constraint_row.oid)) > 0
        ) = 1
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
          'oauth_nonce_ciphertext_minimum_length',
          'oauth_nonce_encryption_metadata_by_provider'
        )
    ) AS legacy_migration_state_matches
  \gset
SQL
      ;;
    'identity:0004_session_authentication_age.sql')
      cat <<'SQL'
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'identity'
        AND table_name = 'sessions'
        AND column_name = 'authenticated_at'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM identity.sessions
      WHERE authenticated_at IS NULL OR authenticated_at > created_at
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
        AND constraint_row.contype = 'c'
        AND position('authenticated_at' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('created_at' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('<=' in pg_get_constraintdef(constraint_row.oid)) > 0
    )
    AND (
      (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'identity'
            AND table_name = 'sessions'
            AND column_name = 'authenticated_at'
            AND is_nullable = 'YES'
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
            AND constraint_row.conname = 'sessions_authentication_present'
            AND constraint_row.contype = 'c'
            AND NOT constraint_row.convalidated
            AND position('authenticated_at IS NOT NULL' in pg_get_constraintdef(constraint_row.oid)) > 0
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
            AND NOT constraint_row.convalidated
        )
      )
      OR
      (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'identity'
            AND table_name = 'sessions'
            AND column_name = 'authenticated_at'
            AND is_nullable = 'NO'
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
            AND constraint_row.convalidated
        )
      )
    ) AS legacy_migration_state_matches
  \gset
SQL
      ;;
    'identity:0005_finalize_session_authentication_age.sql')
      cat <<'SQL'
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'identity'
        AND table_name = 'sessions'
        AND column_name = 'authenticated_at'
        AND is_nullable = 'NO'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM identity.sessions
      WHERE authenticated_at IS NULL OR authenticated_at > created_at
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
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND position('authenticated_at' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('created_at' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('<=' in pg_get_constraintdef(constraint_row.oid)) > 0
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
    SELECT
      COUNT(*) = 5
      AND bool_and(constraint_row.contype = 'c' AND constraint_row.convalidated)
      AND bool_and(
        position('id' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('4[0-9a-f]{3}' in pg_get_constraintdef(constraint_row.oid)) > 0
        AND position('[89ab]' in pg_get_constraintdef(constraint_row.oid)) > 0
      )
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

incomplete_migration_recovery_sql() {
  local service_name="$1"
  local migration_name="$2"

  case "${service_name}:${migration_name}" in
    'identity:0007_identity_database_semantic_names.sql')
      cat <<'SQL'
  SELECT
    (
      to_regclass('identity.users') IS NOT NULL
      AND to_regclass('identity.workspaces') IS NOT NULL
      AND to_regclass('identity.sessions') IS NOT NULL
      AND to_regclass('identity.user_accounts') IS NULL
      AND to_regclass('identity.identity_workspaces') IS NULL
      AND to_regclass('identity.authentication_sessions') IS NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'users' AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'external_identities' AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'external_identities' AND column_name = 'user_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'external_identities' AND column_name = 'provider'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'workspaces' AND column_name = 'owner_user_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'workspaces' AND column_name = 'name'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'workspaces' AND column_name = 'kind'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'sessions' AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'sessions' AND column_name = 'user_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'sessions' AND column_name = 'workspace_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'sessions' AND column_name = 'rotated_from_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'oauth_transactions' AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'oauth_transactions' AND column_name = 'provider'
      )
    ) AS incomplete_migration_retry_allowed,
    (
      to_regclass('identity.users') IS NULL
      AND to_regclass('identity.workspaces') IS NULL
      AND to_regclass('identity.sessions') IS NULL
      AND to_regclass('identity.user_accounts') IS NOT NULL
      AND to_regclass('identity.identity_workspaces') IS NOT NULL
      AND to_regclass('identity.authentication_sessions') IS NOT NULL
      AND (
        SELECT COUNT(*) = 14
        FROM information_schema.columns
        WHERE table_schema = 'identity'
          AND (
            (table_name = 'user_accounts' AND column_name = 'user_account_id')
            OR (table_name = 'external_identities' AND column_name IN (
              'external_identity_id', 'user_account_id', 'identity_provider'
            ))
            OR (table_name = 'identity_workspaces' AND column_name IN (
              'identity_workspace_id', 'owner_user_account_id', 'workspace_name', 'workspace_kind'
            ))
            OR (table_name = 'authentication_sessions' AND column_name IN (
              'authentication_session_id', 'user_account_id', 'identity_workspace_id',
              'rotated_from_session_id'
            ))
            OR (table_name = 'oauth_transactions' AND column_name IN (
              'oauth_transaction_id', 'identity_provider'
            ))
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'identity'
          AND (
            (table_name = 'user_accounts' AND column_name = 'id')
            OR (table_name = 'external_identities' AND column_name IN ('id', 'user_id', 'provider'))
            OR (table_name = 'identity_workspaces' AND column_name IN (
              'id', 'owner_user_id', 'name', 'kind'
            ))
            OR (table_name = 'authentication_sessions' AND column_name IN (
              'id', 'user_id', 'workspace_id', 'rotated_from_id'
            ))
            OR (table_name = 'oauth_transactions' AND column_name IN ('id', 'provider'))
          )
      )
      AND (
        SELECT COUNT(*) = 18
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS relation_row
          ON relation_row.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace_row
          ON namespace_row.oid = relation_row.relnamespace
        WHERE namespace_row.nspname = 'identity'
          AND constraint_row.conname IN (
            'user_accounts_pkey',
            'user_account_id_uuid_v4',
            'external_identities_user_account_fk',
            'external_identity_id_uuid_v4',
            'identity_workspaces_pkey',
            'identity_workspaces_owner_user_account_fk',
            'identity_workspace_owner_unique',
            'identity_workspace_id_uuid_v4',
            'authentication_sessions_pkey',
            'authentication_sessions_user_account_fk',
            'authentication_sessions_rotated_from_session_fk',
            'authentication_sessions_token_hash_key',
            'authentication_session_expiry_after_creation',
            'authentication_session_revocation_after_creation',
            'authentication_session_workspace_owner_fk',
            'authentication_session_authentication_not_after_creation',
            'authentication_session_id_uuid_v4',
            'oauth_transaction_id_uuid_v4'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS relation_row
          ON relation_row.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace_row
          ON namespace_row.oid = relation_row.relnamespace
        WHERE namespace_row.nspname = 'identity'
          AND constraint_row.conname IN (
            'users_pkey',
            'users_id_uuid_v4',
            'external_identities_user_id_fkey',
            'external_identities_id_uuid_v4',
            'workspaces_pkey',
            'workspaces_owner_user_id_fkey',
            'workspaces_id_owner_unique',
            'workspaces_id_uuid_v4',
            'sessions_pkey',
            'sessions_user_id_fkey',
            'sessions_rotated_from_id_fkey',
            'sessions_token_hash_key',
            'sessions_expiry_after_creation',
            'sessions_revocation_after_creation',
            'sessions_workspace_owner_fk',
            'sessions_authentication_not_after_creation',
            'sessions_id_uuid_v4',
            'oauth_transactions_id_uuid_v4'
          )
      )
      AND (
        SELECT COUNT(*) = 4
        FROM pg_indexes
        WHERE schemaname = 'identity'
          AND indexname IN (
            'external_identities_user_account_idx',
            'identity_workspaces_owner_account_idx',
            'authentication_sessions_active_user_account_idx',
            'authentication_sessions_active_workspace_idx'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'identity'
          AND indexname IN (
            'external_identities_user_idx',
            'workspaces_owner_idx',
            'sessions_active_user_idx',
            'sessions_active_workspace_idx'
          )
      )
    ) AS incomplete_migration_reconciliation_allowed
  \gset
SQL
      ;;
    *)
      cat <<'SQL'
  SELECT
    false AS incomplete_migration_retry_allowed,
    false AS incomplete_migration_reconciliation_allowed
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
  local reconciliation_sql recovery_sql
  reconciliation_sql="$(legacy_reconciliation_sql "${service_name}" "${migration_name}")"
  recovery_sql="$(incomplete_migration_recovery_sql "${service_name}" "${migration_name}")"

  cat >>"${command_file}" <<SQL
\\set service_name '${service_name}'
\\set migration_name '${migration_name}'
\\set migration_sequence '${migration_sequence}'
\\set migration_sha256 '${migration_sha}'
\\set migration_should_apply false
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
${recovery_sql}
      \\if :incomplete_migration_retry_allowed
        DELETE FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
        WHERE service_name = :'service_name'
          AND migration_name = :'migration_name'
          AND migration_sha256 = :'migration_sha256'
          AND migration_status = 'applying';
        \\echo migration_status=retrying service=:service_name migration=:migration_name
        \\set migration_should_apply true
      \\else
        \\if :incomplete_migration_reconciliation_allowed
          WITH updated_row AS (
            UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
            SET migration_status = 'applied',
                applied_at = clock_timestamp(),
                migration_reconciled = true
            WHERE service_name = :'service_name'
              AND migration_name = :'migration_name'
              AND migration_sha256 = :'migration_sha256'
              AND migration_status = 'applying'
            RETURNING 1
          )
          SELECT COUNT(*) = 1 AS migration_reconciled_now
          FROM updated_row
          \\gset
          \\if :migration_reconciled_now
            \\echo migration_status=reconciled service=:service_name migration=:migration_name
          \\else
            \\echo migration_error=incomplete_migration_reconciliation_failed service=:service_name migration=:migration_name
            DO \$life_os_migration_guard\$
            BEGIN
              RAISE EXCEPTION 'LifeOS migration guard failed';
            END
            \$life_os_migration_guard\$;
          \\endif
        \\else
          \\echo migration_error=incomplete_migration_requires_reconciliation service=:service_name migration=:migration_name
          DO \$life_os_migration_guard\$
          BEGIN
            RAISE EXCEPTION 'LifeOS migration guard failed';
          END
          \$life_os_migration_guard\$;
        \\endif
      \\endif
    \\endif
  \\else
    \\echo migration_error=migration_digest_changed service=:service_name migration=:migration_name
    DO \$life_os_migration_guard\$
    BEGIN
      RAISE EXCEPTION 'LifeOS migration guard failed';
    END
    \$life_os_migration_guard\$;
  \\endif
\\else
  SELECT (:'migration_name' COLLATE "C") > (:'latest_migration_name' COLLATE "C")
    AS migration_name_is_forward
  \\gset
  \\if :migration_name_is_forward
    \\set migration_should_apply true
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
      DO \$life_os_migration_guard\$
      BEGIN
        RAISE EXCEPTION 'LifeOS migration guard failed';
      END
      \$life_os_migration_guard\$;
    \\endif
  \\endif
\\endif
\\if :migration_should_apply
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
  WITH updated_row AS (
    UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
    SET migration_status = 'applied',
        applied_at = clock_timestamp()
    WHERE service_name = :'service_name'
      AND migration_name = :'migration_name'
      AND migration_sha256 = :'migration_sha256'
      AND migration_status = 'applying'
    RETURNING 1
  )
  SELECT COUNT(*) = 1 AS migration_finalized
  FROM updated_row
  \\gset
  \\if :migration_finalized
    \\echo migration_status=applied service=:service_name migration=:migration_name
  \\else
    \\echo migration_error=migration_ledger_finalization_failed service=:service_name migration=:migration_name
    DO \$life_os_migration_guard\$
    BEGIN
      RAISE EXCEPTION 'LifeOS migration guard failed';
    END
    \$life_os_migration_guard\$;
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
