import { handleAiProposalRequest } from '../../../../ai-proposal-client';

/** Next.js 15 asynchronous dynamic route context. */
interface ProposalRouteContext {
  params: Promise<{ proposalId: string }>;
}

/** Returns one authenticated workspace proposal audit record. */
export async function GET(
  request: Request,
  context: ProposalRouteContext,
): Promise<Response> {
  const { proposalId } = await context.params;
  return await handleAiProposalRequest(
    request,
    process.env,
    { kind: 'proposal', proposalId },
    fetch,
  );
}
