import { handlePlanningGoalCreateRequest } from '../../../planning-goal-client';

/** Creates one durable Goal after the BFF derives workspace authority from Identity. */
export async function POST(request: Request): Promise<Response> {
  return await handlePlanningGoalCreateRequest(request, process.env, fetch);
}
