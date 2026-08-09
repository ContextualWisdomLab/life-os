ALTER TABLE identity.sessions
  ADD COLUMN authenticated_at timestamptz;

WITH RECURSIVE session_authentication_lineage AS (
  SELECT
    session_row.id,
    session_row.user_id,
    session_row.workspace_id,
    session_row.created_at AS root_authenticated_at
  FROM identity.sessions AS session_row
  WHERE session_row.rotated_from_id IS NULL

  UNION ALL

  SELECT
    child_session.id,
    child_session.user_id,
    child_session.workspace_id,
    parent_session.root_authenticated_at
  FROM identity.sessions AS child_session
  JOIN session_authentication_lineage AS parent_session
    ON child_session.rotated_from_id = parent_session.id
   AND child_session.user_id = parent_session.user_id
   AND child_session.workspace_id = parent_session.workspace_id
)
UPDATE identity.sessions AS session_row
SET authenticated_at = lineage.root_authenticated_at
FROM session_authentication_lineage AS lineage
WHERE session_row.id = lineage.id;

ALTER TABLE identity.sessions
  ADD CONSTRAINT sessions_authentication_present
    CHECK (authenticated_at IS NOT NULL) NOT VALID,
  ADD CONSTRAINT sessions_authentication_not_after_creation
    CHECK (authenticated_at <= created_at) NOT VALID;
