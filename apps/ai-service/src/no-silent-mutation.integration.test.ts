import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AiAppModule } from './main';
import {
  type ProposalModel,
  ProposalService,
  RuleBasedProposalModel,
} from './proposal-service';

const WORKSPACE_ID = '43eab0ee-0f7b-4c7f-9331-b133f2647675';
const ACTOR_ID = 'd19b6077-2baa-4f84-97f6-c138b1d6ba34';
const TASK_ID = 'e29c36af-999a-407f-9ca9-cfe194ab51f4';
const PROPOSAL_ID = 'aedcb1d1-cc60-42c6-9357-ec90821fce1b';
const GATEWAY_KEY_ID = 'gateway-2026-08-a';
const GATEWAY_SECRET = Buffer.alloc(32, 7).toString('base64url');

interface JsonHttpResponse {
  statusCode: number;
  body: unknown;
}

function userOwnedState(): {
  objective: string;
  context: Array<{
    id: string;
    kind: 'task';
    title: string;
    status: 'active';
  }>;
} {
  return {
    objective: 'Ship a reviewable product increment',
    context: [
      {
        id: TASK_ID,
        kind: 'task',
        title: 'Verify the release candidate',
        status: 'active',
      },
    ],
  };
}

/** Signs one exact POST path with authenticated workspace and actor scope. */
function signedContextHeaders(path: string): Readonly<Record<string, string>> {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.ai-context.v2\n${GATEWAY_KEY_ID}\n${WORKSPACE_ID}\n${ACTOR_ID}\n${issuedAt}\nPOST\n${path}`,
      'utf8',
    )
    .digest('base64url');
  return {
    'x-life-os-context-key-id': GATEWAY_KEY_ID,
    'x-life-os-workspace-id': WORKSPACE_ID,
    'x-life-os-actor-id': ACTOR_ID,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  };
}

function postJson(
  address: AddressInfo,
  path: string,
  body: unknown,
): Promise<JsonHttpResponse> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...signedContextHeaders(path),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            reject(new Error('HTTP response was not valid JSON'));
            return;
          }
          resolve({
            statusCode: response.statusCode ?? 0,
            body: parsed,
          });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

describe('AI proposal no-silent-mutation contract', () => {
  it('generates an inert proposal while leaving user-owned state byte-identical', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const service = new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    );

    const proposal = await service.generateProposal(WORKSPACE_ID, state);

    expect(JSON.stringify(state)).toBe(before);
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.operations).toEqual([
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description:
          'Prioritize Verify the release candidate for explicit user review.',
      },
    ]);
    expect('execute' in proposal).toBe(false);
    expect('apply' in proposal).toBe(false);
  });

  it('freezes model evidence so a mutating adapter fails closed', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const mutatingModel: ProposalModel = {
      async generate(input) {
        const firstItem = input.context[0];
        if (firstItem) {
          (firstItem as { title: string }).title = 'Silently changed';
        }
        return {
          summary: 'This output must never be accepted',
          rationale: ['Mutation was attempted'],
          operations: [
            {
              kind: 'create_task',
              description: 'Unsafe task',
            },
          ],
        };
      },
    };
    const service = new ProposalService(mutatingModel);

    await expect(service.generateProposal(WORKSPACE_ID, state)).rejects.toThrow(
      TypeError,
    );
    expect(JSON.stringify(state)).toBe(before);
  });

  it('exercises the authenticated HTTP module without exposing a mutation route', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const originalKeyId = process.env.AI_GATEWAY_ACTIVE_KEY_ID;
    const originalSecret = process.env.AI_GATEWAY_ACTIVE_KEY_SECRET;
    process.env.AI_GATEWAY_ACTIVE_KEY_ID = GATEWAY_KEY_ID;
    process.env.AI_GATEWAY_ACTIVE_KEY_SECRET = GATEWAY_SECRET;
    const app = await NestFactory.create(AiAppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const response = await postJson(address, '/v1/proposals', state);

      expect(response.statusCode).toBe(201);
      expect(response.body).toMatchObject({
        workspaceId: WORKSPACE_ID,
        requiresConfirmation: true,
        operations: [
          {
            kind: 'prioritize_item',
            targetId: TASK_ID,
          },
        ],
      });
      expect(JSON.stringify(state)).toBe(before);

      const unsupportedMutation = await postJson(
        address,
        '/v1/proposals/apply',
        { proposalId: PROPOSAL_ID },
      );
      expect(unsupportedMutation.statusCode).toBe(404);
    } finally {
      await app.close();
      if (originalKeyId === undefined) {
        delete process.env.AI_GATEWAY_ACTIVE_KEY_ID;
      } else {
        process.env.AI_GATEWAY_ACTIVE_KEY_ID = originalKeyId;
      }
      if (originalSecret === undefined) {
        delete process.env.AI_GATEWAY_ACTIVE_KEY_SECRET;
      } else {
        process.env.AI_GATEWAY_ACTIVE_KEY_SECRET = originalSecret;
      }
    }
  });
});
