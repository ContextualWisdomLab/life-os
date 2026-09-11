ALTER TABLE planning.tasks
  ADD CONSTRAINT tasks_completion_state_check
  CHECK (
    (status = 'todo' AND completed_at IS NULL)
    OR (
      status = 'done'
      AND completed_at IS NOT NULL
      AND completed_at >= created_at
    )
  ) NOT VALID;
