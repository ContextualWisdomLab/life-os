import {
  createAiContextHeaders,
  handleAiProposalRequest as handleAiProposalRequestCore,
  parseAiSessionPrincipal,
  requireAiGatewaySecret,
  requireAiServiceOrigin,
  type AiProposalFetch,
  type AiProposalRoute,
  type AiSessionPrincipal,
} from './ai-proposal-client-core';

export {
  createAiContextHeaders,
  parseAiSessionPrincipal,
  requireAiGatewaySecret,
  requireAiServiceOrigin,
};
export type { AiProposalFetch, AiProposalRoute, AiSessionPrincipal };

const MAXIMUM_IDENTITY_RESPONSE_BYTES = 32 * 1024;

/** Narrows untrusted JSON to a non-array record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Bounded identity response payload that can be safely replayed to the core. */
interface BoundedIdentityPayload {
  readonly value: unknown;
  readonly text: string;
}

/** Reads one identity response exactly once without unbounded stream tee buffering. */
async function readBoundedIdentityJson(
  response: Response,
): Promise<BoundedIdentityPayload> {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0];
  if (mediaType !== 'application/json') {
    throw new Error('Identity session response is invalid');
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_IDENTITY_RESPONSE_BYTES)
  ) {
    throw new Error('Identity session response is invalid');
  }
  if (!response.body) {
    throw new Error('Identity session response is invalid');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAXIMUM_IDENTITY_RESPONSE_BYTES) {
        await reader.cancel('Identity response exceeds byte limit');
        throw new Error('Identity session response is invalid');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    try {
      await reader.cancel('Identity response is invalid');
    } catch {
      // Cancellation is best-effort after malformed or oversized input.
    }
    throw new Error('Identity session response is invalid');
  } finally {
    reader.releaseLock();
  }
  if (!text) {
    throw new Error('Identity session response is invalid');
  }
  try {
    return Object.freeze({ value: JSON.parse(text) as unknown, text });
  } catch {
    throw new Error('Identity session response is invalid');
  }
}

/** Reconstructs one already bounded identity response for the transport core. */
function replayIdentityResponse(
  response: Response,
  payload: BoundedIdentityPayload,
): Response {
  return new Response(payload.text, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload.text, 'utf8')),
    },
  });
}

/** Creates the local credential-free failure used for scope mismatches. */
function unavailableAiProposal(correlationId: string | null): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: 'AI proposal service is unavailable',
      status: 503,
      code: 'ai_proposal_unavailable',
    },
    {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/problem+json',
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
      },
    },
  );
}

/** Returns the workspace carried by a validated proposal representation. */
function proposalScope(value: unknown):
  | {
      workspaceId: string;
      proposalId: string;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  const workspaceId = value.workspaceId;
  const proposalId = value.proposalId;
  if (typeof workspaceId !== 'string' || typeof proposalId !== 'string') {
    return undefined;
  }
  return { workspaceId, proposalId };
}

/** Returns the proposal scope carried by a validated immutable audit record. */
function auditScope(value: unknown):
  | {
      workspaceId: string;
      proposalId: string;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  return proposalScope(value.proposal);
}

/** Returns the scope carried by a validated append-only decision event. */
function decisionScope(value: unknown):
  | {
      workspaceId: string;
      actorId: string;
      proposalId: string;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  const workspaceId = value.workspaceId;
  const actorId = value.actorId;
  const proposalId = value.proposalId;
  if (
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof proposalId !== 'string'
  ) {
    return undefined;
  }
  return { workspaceId, actorId, proposalId };
}

/** Verifies that one successful AI representation remains in session scope. */
function responseMatchesPrincipal(
  value: unknown,
  route: AiProposalRoute,
  method: string,
  principal: AiSessionPrincipal,
): boolean {
  if (route.kind === 'collection') {
    if (method === 'POST') {
      return proposalScope(value)?.workspaceId === principal.workspaceId;
    }
    return (
      Array.isArray(value) &&
      value.every(
        (record) => auditScope(record)?.workspaceId === principal.workspaceId,
      )
    );
  }

  if (route.kind === 'proposal') {
    const scope = auditScope(value);
    return (
      scope?.workspaceId === principal.workspaceId &&
      scope.proposalId === route.proposalId
    );
  }

  if (method === 'POST') {
    const scope = decisionScope(value);
    return (
      scope?.workspaceId === principal.workspaceId &&
      scope.actorId === principal.actorId &&
      scope.proposalId === route.proposalId
    );
  }

  return (
    Array.isArray(value) &&
    value.every((event) => {
      const scope = decisionScope(event);
      return (
        scope?.workspaceId === principal.workspaceId &&
        scope.proposalId === route.proposalId
      );
    })
  );
}

/**
 * Authenticates and signs through the transport core, then independently
 * verifies that every successful upstream representation remains bound to the
 * identity-session workspace and, for a newly recorded decision, its actor.
 */
export async function handleAiProposalRequest(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>,
  route: AiProposalRoute,
  fetcher: AiProposalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let principal: AiSessionPrincipal | undefined;
  let identityObserved = false;
  const observingFetcher: AiProposalFetch = async (input, init) => {
    const response = await fetcher(input, init);
    const url = new URL(String(input));
    if (!identityObserved && url.pathname === '/v1/session') {
      identityObserved = true;
      if (response.status === 200) {
        try {
          const payload = await readBoundedIdentityJson(response);
          principal = parseAiSessionPrincipal(payload.value);
          return replayIdentityResponse(response, payload);
        } catch {
          principal = undefined;
          return new Response(null, { status: 502 });
        }
      }
    }
    return response;
  };

  const response = await handleAiProposalRequestCore(
    request,
    environment,
    route,
    observingFetcher,
    nowSeconds,
  );
  if (response.status !== 200 && response.status !== 201) {
    return response;
  }
  if (!principal) {
    return unavailableAiProposal(response.headers.get('x-correlation-id'));
  }
  try {
    const value = (await response.clone().json()) as unknown;
    if (!responseMatchesPrincipal(value, route, request.method, principal)) {
      return unavailableAiProposal(response.headers.get('x-correlation-id'));
    }
  } catch {
    return unavailableAiProposal(response.headers.get('x-correlation-id'));
  }
  return response;
}
