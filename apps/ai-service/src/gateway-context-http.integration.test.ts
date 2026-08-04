import { createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiAppModule } from './main';

const GATEWAY_SECRET = '0123456789abcdef0123456789abcdef';
const ORIGINAL_GATEWAY_SECRET = process.env.AI_GATEWAY_CONTEXT_SECRET;
let app: INestApplication;
let address: AddressInfo;

/** Creates the exact signature contract accepted by the AI service. */
function signedHeaders(
  workspaceId: string,
  actorId: string,
  issuedAt = String(Math.floor(Date.now() / 1000)),
): Readonly<Record<string, string>> {
  const signature = createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
  return {
    'x-life-os-workspace-id': workspaceId,
    'x-life-os-actor-id': actorId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  };
}

/** Changes a significant base64url character so the decoded digest must differ. */
function forgeSignature(signature: string): string {
  const replacement = signature.startsWith('A') ? 'B' : 'A';
  return `${replacement}${signature.slice(1)}`;
}

/** Sends one bounded proposal request with an explicitly selected header set. */
function postProposal(
  headers: Readonly<Record<string, string>>,
): Promise<{ statusCode: number; body: unknown }> {
  const payload = JSON.stringify({
    objective: 'Review signed AI gateway enforcement',
    context: [
      {
        id: randomUUID(),
        kind: 'task',
        title: 'Verify authenticated proposal generation',
        status: 'active',
      },
    ],
  });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/v1/proposals',
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: text ? JSON.parse(text) : null,
            });
          } catch {
            reject(new Error('HTTP response was not valid JSON'));
          }
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

describe('AI signed gateway HTTP boundary', () => {
  beforeAll(async () => {
    process.env.AI_GATEWAY_CONTEXT_SECRET = GATEWAY_SECRET;
    app = await NestFactory.create(AiAppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    address = app.getHttpServer().address() as AddressInfo;
  });

  afterAll(async () => {
    await app.close();
    if (ORIGINAL_GATEWAY_SECRET === undefined) {
      delete process.env.AI_GATEWAY_CONTEXT_SECRET;
    } else {
      process.env.AI_GATEWAY_CONTEXT_SECRET = ORIGINAL_GATEWAY_SECRET;
    }
  });

  it('accepts the authenticated signed actor and workspace context', async () => {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    const response = await postProposal(signedHeaders(workspaceId, actorId));

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      workspaceId,
      requiresConfirmation: true,
    });
  });

  it('does not authorize legacy client-selected ownership headers', async () => {
    const response = await postProposal({
      'x-workspace-id': randomUUID(),
      'x-actor-id': randomUUID(),
    });

    expect(response).toMatchObject({
      statusCode: 401,
      body: { code: 'invalid_gateway_context' },
    });
  });

  it('maps stale and forged contexts to the same credential-free refusal', async () => {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    const stale = await postProposal(
      signedHeaders(
        workspaceId,
        actorId,
        String(Math.floor(Date.now() / 1000) - 61),
      ),
    );
    const authentic = signedHeaders(workspaceId, actorId);
    const signature = authentic['x-life-os-context-signature'];
    const forged = await postProposal({
      ...authentic,
      'x-life-os-context-signature': forgeSignature(signature),
    });

    expect(stale).toMatchObject({
      statusCode: 401,
      body: { code: 'invalid_gateway_context' },
    });
    expect(forged).toMatchObject({
      statusCode: 401,
      body: { code: 'invalid_gateway_context' },
    });
  });

  it('fails closed when the verifier secret is unavailable', async () => {
    delete process.env.AI_GATEWAY_CONTEXT_SECRET;
    try {
      const response = await postProposal(
        signedHeaders(randomUUID(), randomUUID()),
      );
      expect(response).toMatchObject({
        statusCode: 503,
        body: { code: 'gateway_context_unavailable' },
      });
    } finally {
      process.env.AI_GATEWAY_CONTEXT_SECRET = GATEWAY_SECRET;
    }
  });
});
