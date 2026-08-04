import { handleAiProposalRequest } from '../../../../../ai-proposal-client';

/** Next.js 15 asynchronous dynamic route context. */
interface ProposalDecisionRouteContext {
  params: Promise<{ proposalId: string }>;
}

/** Lists append-only decisions for one authenticated workspace proposal. */
export async function GET(
  request: Request,
  context: ProposalDecisionRouteContext,
): Promise<Response> {
  const { proposalId } = await context.params;
  return await handleAiProposalRequest(
    request,
    process.env,
    { kind: 'decisions', proposalId },
    fetch,
  );
}

/** Appends an explicit authenticated-actor decision without executing operations. */
export async function POST(
  request: Request,
  context: ProposalDecisionRouteContext,
): Promise<Response> {
  const { proposalId } = await context.params;
  return await handleAiProposalRequest(
    request,
    process.env,
    { kind: 'decisions', proposalId },
    fetch,
  );
}
