import { handlePlanningSearchRequest } from '../../../planning-search-client';

/** Serves authenticated, tenant-derived planning search to the browser. */
export async function GET(request: Request): Promise<Response> {
  return await handlePlanningSearchRequest(request, process.env, fetch);
}
