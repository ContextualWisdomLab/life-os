import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parsePlanningSearchResults,
  parseSessionWorkspace,
} from './planning-search-client';

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
const TASK_ID = 'b1c2d3e4-f5a6-4b1c-9d2e-3f4a5b6c7d8e';
const PROJECT_ID = 'c1d2e3f4-a5b6-4c1d-a2e3-4f5a6b7c8d9e';
const CREATED_AT = '2026-08-04T02:00:00.000Z';

function taskResult(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'task',
    id: TASK_ID,
    title: 'Ship canonical search evidence',
    parentId: PROJECT_ID,
    status: 'todo',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('planning search canonical service evidence', () => {
  it('rejects byte-different workspace identity from Identity', () => {
    assert.throws(
      () => parseSessionWorkspace({ workspaceId: WORKSPACE_ID.toUpperCase() }),
      new Error('Identity session response is invalid'),
    );
  });

  it('rejects byte-different Planning entity and parent identities', () => {
    for (const result of [
      taskResult({ id: TASK_ID.toUpperCase() }),
      taskResult({ parentId: PROJECT_ID.toUpperCase() }),
    ]) {
      assert.throws(
        () => parsePlanningSearchResults([result]),
        new Error('Planning search response is invalid'),
      );
    }
  });

  it('rejects equivalent but noncanonical Planning timestamps', () => {
    assert.throws(
      () =>
        parsePlanningSearchResults([
          taskResult({ createdAt: '2026-08-04T03:00:00.000+01:00' }),
        ]),
      new Error('Planning search response is invalid'),
    );
  });
});
