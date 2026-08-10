CREATE SCHEMA IF NOT EXISTS calendar_integration;

CREATE TABLE calendar_integration.calendar_connection_record (
    connection_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider_code text NOT NULL,
    provider_account_subject text NOT NULL,
    scope_values text[] NOT NULL,
    access_secret_handle text NOT NULL,
    refresh_secret_handle text,
    token_expires_at timestamptz NOT NULL,
    selected_calendar_identifier text NOT NULL,
    connection_status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (provider_code IN ('google', 'caldav')),
    CHECK (connection_status IN ('active', 'revoked')),
    CHECK (cardinality(scope_values) BETWEEN 1 AND 32),
    CHECK (char_length(provider_account_subject) BETWEEN 1 AND 512),
    CHECK (char_length(access_secret_handle) BETWEEN 1 AND 1024),
    CHECK (refresh_secret_handle IS NULL OR char_length(refresh_secret_handle) BETWEEN 1 AND 1024),
    CHECK (char_length(selected_calendar_identifier) BETWEEN 1 AND 1024),
    CHECK (token_expires_at > created_at),
    CHECK (updated_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK (
        (connection_status = 'active' AND revoked_at IS NULL)
        OR (connection_status = 'revoked' AND revoked_at IS NOT NULL)
    ),
    UNIQUE (workspace_id, user_id, provider_code, provider_account_subject, selected_calendar_identifier)
);
