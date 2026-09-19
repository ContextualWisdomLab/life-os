ALTER TABLE planning.tasks
  ADD COLUMN due_at timestamptz;

COMMENT ON COLUMN planning.tasks.due_at IS
  'Optional Planning-owned task deadline instant. NULL means no deadline; application boundaries require canonical UTC ISO input before persistence.';
