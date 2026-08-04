import { handleAiProposalRequest } from '../../../ai-proposal-client';

/** Lists authenticated workspace proposal evidence through the same-origin BFF. */
export async function GET(request: Request): Promise<Response> {
  return await handleAiProposalRequest(
    request,
    process.env,
    { kind: 'collection' },
    fetch,
  );
}

/** Generates one inert authenticated workspace proposal through the same-origin BFF. */
export async function POST(request: Request): Promise<Response> {
  return await handleAiProposalRequest(
    request,
    process.env,
    { kind: 'collection' },
    fetch,
  );
}
