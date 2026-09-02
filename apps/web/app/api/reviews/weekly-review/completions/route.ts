import { handleWeeklyReviewCompletionRequest } from '../../../../review-client';

/** Records an authenticated immutable Weekly Review completion. */
export async function POST(request: Request): Promise<Response> {
  return await handleWeeklyReviewCompletionRequest(request, process.env, fetch);
}
