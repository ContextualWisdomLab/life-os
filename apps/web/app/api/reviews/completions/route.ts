import { handleReviewHistoryRequest } from '../../../review-client';

/** Lists authenticated immutable Review completion history. */
export async function GET(request: Request): Promise<Response> {
  return await handleReviewHistoryRequest(request, process.env, fetch);
}
