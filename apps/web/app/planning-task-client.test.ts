import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlanningContextHeaders } from './planning-search-client';
import {
  handlePlanningTaskCreateRequest,
  handlePlanningTaskListRequest,
  type PlanningTaskFetch,
} from './planning-task-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_TASK_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CONTEXT_SECRET = 'planning-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
  PLANNING_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
};

function sessionResponse(): Response {
  return Response.json({
    sessionId: '66666666-6666-4666-8666-666666666666',
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-09-01T01:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
  });
}

function taskRecord(
  overrides: Partial<
    Record<
      'id' | 'workspaceId' | 'projectId' | 'title' | 'status' | 'createdAt',
      unknown
    >
  > = {},
): Record<string, unknown> {
  return {
    id: TASK_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    title: 'Wire authenticated task boundary',
    status: 'todo',
    createdAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  };
}

function createRequest(projectId: string, body: unknown): Request {
  return new Request(
    `https://life-os.example/api/planning/projects/${projectId}/tasks`,
    {
      method: 'POST',
      headers: {
        cookie: 'life_os_session=opaque_session_value',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

function listRequest(projectId: string): Request {
  return new Request(
    `https://life-os.example/api/planning/projects/${projectId}/tasks`,
    { headers: { cookie: 'life_os_session=opaque_session_value' } },
  );
}

describe('authenticated planning task creation BFF', () => {
  it('derives workspace authority and signs the exact project task route', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: PlanningTaskFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? sessionResponse()
        : Response.json(taskRecord(), { status: 201 });
    };

    const response = await handlePlanningTaskCreateRequest(
      createRequest(PROJECT_ID, { title: 'Wire authenticated task boundary' }),
      PROJECT_ID,
      environment,
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: TASK_ID,
      projectId: PROJECT_ID,
      title: 'Wire authenticated task boundary',
      status: 'todo',
      createdAt: '2026-09-01T02:00:00.000Z',
    });
    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      calls[1]?.url,
      `http://planning-service:4102/v1/projects/${PROJECT_ID}/tasks`,
    );
    assert.equal(new Headers(calls[1]?.init?.headers).get('cookie'), null);
    const expected = createPlanningContextHeaders(
      WORKSPACE_ID,
      CONTEXT_SECRET,
      NOW_SECONDS,
      { method: 'POST', path: `/v1/projects/${PROJECT_ID}/tasks` },
    );
    assert.equal(
      new Headers(calls[1]?.init?.headers).get('x-life-os-context-signature'),
      expected['x-life-os-context-signature'],
    );
  });

  it('rejects invalid parent identifiers and browser-selected authority before dependencies', async () => {
    const cases: Array<{ projectId: string; body: unknown }> = [
      { projectId: 'not-a-uuid', body: { title: 'Valid title' } },
      { projectId: PROJECT_ID, body: {} },
      { projectId: PROJECT_ID, body: { title: '' } },
      { projectId: PROJECT_ID, body: { title: 'x'.repeat(161) } },
      { projectId: PROJECT_ID, body: { title: 'valid', projectId: PROJECT_ID } },
      { projectId: PROJECT_ID, body: { title: 'valid', workspaceId: WORKSPACE_ID } },
    ];
    for (const entry of cases) {
      let called = false;
      const response = await handlePlanningTaskCreateRequest(
        createRequest(entry.projectId, entry.body),
        entry.projectId,
        environment,
        async () => {
          called = true;
          return sessionResponse();
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 400);
      assert.equal(called, false);
      assert.equal((await response.json()).code, 'invalid_task_request');
    }
  });

  it('preserves tenant-indistinguishable missing-project semantics', async () => {
    let calls = 0;
    const response = await handlePlanningTaskCreateRequest(
      createRequest(PROJECT_ID, { title: 'Task' }),
      PROJECT_ID,
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json({ title: 'Project not found' }, { status: 404 });
      },
      NOW_SECONDS,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Project was not found',
      status: 404,
      code: 'project_not_found',
    });
  });
});

describe('authenticated planning task listing BFF', () => {
  it('returns only browser-safe tasks matching workspace and parent project', async () => {
    let calls = 0;
    const response = await handlePlanningTaskListRequest(
      listRequest(PROJECT_ID),
      PROJECT_ID,
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json([
              taskRecord(),
              taskRecord({
                id: SECOND_TASK_ID,
                title: 'Finish task contract',
                status: 'done',
              }),
            ]);
      },
      NOW_SECONDS,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        id: TASK_ID,
        projectId: PROJECT_ID,
        title: 'Wire authenticated task boundary',
        status: 'todo',
        createdAt: '2026-09-01T02:00:00.000Z',
      },
      {
        id: SECOND_TASK_ID,
        projectId: PROJECT_ID,
        title: 'Finish task contract',
        status: 'done',
        createdAt: '2026-09-01T02:00:00.000Z',
      },
    ]);
  });

  it('fails closed on cross-scope, duplicate, invalid-status, and oversized collections', async () => {
    const baseTask = taskRecord();
    const invalidCollections: unknown[] = [
      [{ ...baseTask, workspaceId: SECOND_TASK_ID }],
      [{ ...baseTask, projectId: SECOND_TASK_ID }],
      [baseTask, { ...baseTask, title: 'Duplicate task' }],
      [{ ...baseTask, status: 'blocked' }],
      Array.from({ length: 101 }, (_, index) => ({
        ...baseTask,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    ];
    for (const collection of invalidCollections) {
      let calls = 0;
      const response = await handlePlanningTaskListRequest(
        listRequest(PROJECT_ID),
        PROJECT_ID,
        environment,
        async () => {
          calls += 1;
          return calls === 1 ? sessionResponse() : Response.json(collection);
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'task_listing_unavailable');
    }
  });
});
