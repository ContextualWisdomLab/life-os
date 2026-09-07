import {
  handlePlanningGoalCreateRequest,
  handlePlanningGoalListRequest,
} from '../../../planning-goal-client';

/** Lists durable Goals after the BFF derives workspace authority from Identity. */
export async function GET(request: Request): Promise<Response> {
  return await handlePlanningGoalListRequest(request, process.env, fetch);
}

/** Creates one durable Goal after the BFF derives workspace authority from Identity. */
export async function POST(request: Request): Promise<Response> {
  return await handlePlanningGoalCreateRequest(request, process.env, fetch);
}
