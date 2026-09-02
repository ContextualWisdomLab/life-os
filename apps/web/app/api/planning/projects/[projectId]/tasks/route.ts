import {
  handlePlanningTaskCreateRequest,
  handlePlanningTaskListRequest,
} from '../../../../../planning-task-client';

/** Next.js 15 asynchronous dynamic route context for one parent Project. */
interface PlanningTaskRouteContext {
  params: Promise<{ projectId: string }>;
}

/** Lists Tasks below the authenticated, route-bound Project. */
export async function GET(
  request: Request,
  context: PlanningTaskRouteContext,
): Promise<Response> {
  const { projectId } = await context.params;
  return await handlePlanningTaskListRequest(
    request,
    projectId,
    process.env,
    fetch,
  );
}

/** Creates a Task below the authenticated, route-bound Project. */
export async function POST(
  request: Request,
  context: PlanningTaskRouteContext,
): Promise<Response> {
  const { projectId } = await context.params;
  return await handlePlanningTaskCreateRequest(
    request,
    projectId,
    process.env,
    fetch,
  );
}
