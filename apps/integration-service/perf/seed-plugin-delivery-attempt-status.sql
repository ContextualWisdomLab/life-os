BEGIN;

INSERT INTO plugin_integration.plugin_installation_record (
    installation_id,
    workspace_id,
    installed_by_user_id,
    plugin_id,
    plugin_contract_version,
    manifest_sha256,
    granted_capabilities,
    installation_status,
    installed_at,
    revoked_at
) VALUES (
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'life-os.performance.status',
    'life-os.plugin.v1',
    repeat('0', 64),
    ARRAY[]::text[],
    'active',
    clock_timestamp() - INTERVAL '10 minutes',
    NULL
);

INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
    authority_version,
    grant_id,
    installation_id,
    workspace_id,
    granted_by_user_id,
    origin_uri,
    grant_status,
    granted_at,
    revoked_at
) VALUES (
    'life-os.plugin-delivery-origin.v1',
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'https://performance.example.test',
    'active',
    clock_timestamp() - INTERVAL '9 minutes',
    NULL
);

INSERT INTO plugin_integration.plugin_delivery_attempt_record (
    authority_version,
    delivery_id,
    grant_id,
    installation_id,
    workspace_id,
    requested_by_user_id,
    delivery_status,
    attempt_count,
    max_attempts,
    requested_at,
    updated_at,
    next_attempt_at,
    terminal_at,
    last_outcome_code
) VALUES (
    'life-os.plugin-delivery-attempt.v1',
    '33333333-3333-4333-8333-333333333333',
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'pending',
    0,
    3,
    clock_timestamp() - INTERVAL '1 minute',
    clock_timestamp() - INTERVAL '1 minute',
    clock_timestamp() + INTERVAL '5 minutes',
    NULL,
    NULL
);

COMMIT;
