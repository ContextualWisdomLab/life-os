from __future__ import annotations

import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} anchor, found {count}: {old[:80]!r}")
    return text.replace(old, new)


def stage_tests() -> None:
    path = Path("apps/planning-service/src/task-completion.test.ts")
    text = path.read_text()
    text = replace_once(
        text,
        "    this.calls.push({ text, values });\n    return { rows: this.rows as Row[] };",
        "    this.calls.push({ text, values });\n    return {\n      rows: this.rows.map((row) => {\n        if (row === null || typeof row !== 'object' || Array.isArray(row)) {\n          return row as Row;\n        }\n        return {\n          previous_status: 'todo',\n          completion_fact_count: 1,\n          ...(row as Record<string, unknown>),\n        } as Row;\n      }),\n    };",
        "SQL fixture",
    )
    text = replace_once(
        text,
        "        status: 'done',\n        completed_at: FIRST_COMPLETED_AT,\n      },",
        "        status: 'done',\n        completed_at: FIRST_COMPLETED_AT,\n        previous_status: 'done',\n        completion_fact_count: 0,\n      },",
        "retry fixture",
    )
    text = replace_once(
        text,
        "    expect(client.calls[0]?.values).toEqual([\n      WORKSPACE_ID,\n      TASK_ID,\n      'done',\n      COMPLETED_AT,\n    ]);",
        "    const boundValues = client.calls[0]?.values;\n    expect(boundValues?.slice(0, 4)).toEqual([\n      WORKSPACE_ID,\n      TASK_ID,\n      'done',\n      COMPLETED_AT,\n    ]);\n    expect(boundValues).toHaveLength(5);\n    expect(boundValues?.[4]).toEqual(\n      expect.stringMatching(\n        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,\n      ),\n    );",
        "UUID bind assertion",
    )
    anchor = "  it('canonicalizes a valid Date returned by the PostgreSQL driver', async () => {"
    regression = """  it('fails closed when persistence reports no fact for a new completion', async () => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: WORKSPACE_ID,
          id: TASK_ID,
          status: 'done',
          completed_at: COMPLETED_AT,
          previous_status: 'todo',
          completion_fact_count: 0,
        },
      ]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it.each([
    ['a completed retry that appends a fact', 'done', FIRST_COMPLETED_AT, 'done', 1],
    ['a reopen that appends a fact', 'todo', null, 'done', 1],
    ['an unknown prior state', 'done', COMPLETED_AT, 'archived', 1],
    ['an invalid completion fact count', 'done', COMPLETED_AT, 'todo', 2],
  ] as const)(
    'fails closed on %s',
    async (_name, status, completedAt, previousStatus, completionFactCount) => {
      const repository = new PostgresTaskCompletionRepository(
        new RecordingSqlClient([
          {
            workspace_id: WORKSPACE_ID,
            id: TASK_ID,
            status,
            completed_at: completedAt,
            previous_status: previousStatus,
            completion_fact_count: completionFactCount,
          },
        ]),
      );
      const transition: TaskCompletionTransition =
        status === 'done'
          ? { status: 'done', completedAt: COMPLETED_AT }
          : { status: 'todo', completedAt: null };

      await expect(
        repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, transition),
      ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
    },
  );

"""
    text = replace_once(text, anchor, regression + anchor, "regression")
    path.write_text(text)


def apply_repair() -> None:
    completion = Path("apps/planning-service/src/task-completion.ts")
    text = completion.read_text()
    text = replace_once(
        text,
        "interface TaskCompletionRow {\n  workspace_id: unknown;\n  id: unknown;\n  status: unknown;\n  completed_at: unknown;\n}",
        "interface TaskCompletionRow {\n  workspace_id: unknown;\n  id: unknown;\n  status: unknown;\n  completed_at: unknown;\n  previous_status: unknown;\n  completion_fact_count: unknown;\n}",
        "completion row",
    )
    text = replace_once(
        text,
        "  return parsed.toISOString();\n}\n\n/** Parses one returned row and proves it matches the requested durable state. */",
        "  return parsed.toISOString();\n}\n\n/** Requires the prior durable task state needed to interpret fact creation. */\nfunction requirePersistedPreviousStatus(value: unknown): 'todo' | 'done' {\n  if (value !== 'todo' && value !== 'done') {\n    return invalidPersistenceEvidence();\n  }\n  return value;\n}\n\n/** Requires the bounded fact cardinality emitted by the atomic completion statement. */\nfunction requirePersistedCompletionFactCount(value: unknown): 0 | 1 {\n  if (value !== 0 && value !== 1) {\n    return invalidPersistenceEvidence();\n  }\n  return value;\n}\n\n/** Parses one returned row and proves it matches the requested durable state. */",
        "validation helper",
    )
    text = replace_once(
        text,
        "  if (workspaceId !== expectedWorkspaceId || taskId !== expectedTaskId) {\n    return invalidPersistenceEvidence();\n  }\n\n  if (row.status === 'todo') {",
        "  if (workspaceId !== expectedWorkspaceId || taskId !== expectedTaskId) {\n    return invalidPersistenceEvidence();\n  }\n\n  const previousStatus = requirePersistedPreviousStatus(row.previous_status);\n  const completionFactCount = requirePersistedCompletionFactCount(\n    row.completion_fact_count,\n  );\n  const expectedCompletionFactCount =\n    expectedTransition.status === 'done' && previousStatus === 'todo' ? 1 : 0;\n  if (completionFactCount !== expectedCompletionFactCount) {\n    return invalidPersistenceEvidence();\n  }\n\n  if (row.status === 'todo') {",
        "durable acceptance",
    )
    text = replace_once(
        text,
        "           RETURNING workspace_id, id, status, completed_at, previous.previous_status\n         ),",
        "           RETURNING workspace_id, id, status, completed_at,\n                     previous.previous_status AS previous_status\n         ),",
        "previous-state return",
    )
    text = replace_once(
        text,
        "         SELECT workspace_id,\n                id,\n                status,\n                completed_at,\n                (SELECT count(*) FROM completion_fact) AS completion_fact_count\n         FROM updated`",
        "         SELECT workspace_id,\n                id,\n                status,\n                completed_at,\n                previous_status,\n                (SELECT count(*)::integer FROM completion_fact) AS completion_fact_count\n         FROM updated`",
        "fact-count return",
    )
    completion.write_text(text)

    rights = Path("apps/planning-service/src/planning-data-rights.ts")
    text = rights.read_text()
    text = replace_once(
        text,
        "interface PlanningTaskCompletionFactExportRow {\n  completion_sequence: unknown;\n  task_id: unknown;\n  completed_at: unknown;\n}",
        "interface PlanningTaskCompletionFactExportRow {\n  task_id: unknown;\n  completed_at: unknown;\n}",
        "export row",
    )
    text = replace_once(
        text,
        "`SELECT completion_sequence::text, task_id, completed_at\n             FROM planning.task_completion_facts\n             WHERE workspace_id = $1\n             ORDER BY completed_at ASC, task_id ASC, completion_sequence ASC\n             LIMIT $2 OFFSET $3`",
        "`SELECT task_id, completed_at\n             FROM planning.task_completion_facts\n             WHERE workspace_id = $1\n             ORDER BY completed_at ASC, task_id ASC, completion_fact_id ASC\n             LIMIT $2 OFFSET $3`",
        "export query",
    )
    text = replace_once(
        text,
        "          (row) => ({\n            completionSequence: requireString(\n              row.completion_sequence,\n              'taskCompletionFact.completion_sequence',\n            ),\n            taskId: requireUuidV4(row.task_id, 'taskCompletionFact.task_id'),",
        "          (row) => ({\n            taskId: requireUuidV4(row.task_id, 'taskCompletionFact.task_id'),",
        "export mapper",
    )
    rights.write_text(text)

    readme = Path("apps/planning-service/migrations/README.md")
    docs = readme.read_text()
    docs = replace_once(
        docs,
        "Every fact has an application-generated opaque UUIDv4 primary key; `completion_sequence` is a separate unique ordering key, not domain identity.",
        "Every fact has an application-generated opaque UUIDv4 primary key; `completion_sequence` is a separate unique ordering key, not domain identity and is not exported through the data-rights contract.",
        "migration documentation",
    )
    readme.write_text(docs)


if len(sys.argv) != 2 or sys.argv[1] not in {"stage-tests", "apply-repair"}:
    raise SystemExit("usage: repair_planning_completion.py stage-tests|apply-repair")

if sys.argv[1] == "stage-tests":
    stage_tests()
else:
    apply_repair()
