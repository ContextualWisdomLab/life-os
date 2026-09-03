import {
  handlePlanningProjectCreateRequest,
  handlePlanningProjectListRequest,
} from '../../../../../planning-goal-client';

/** Next.js 15 asynchronous dynamic route context for one parent Goal. */
interface PlanningProjectRouteContext {
  params: Promise<{ goalId: string }>;
}

/** Lists Projects below the authenticated, route-bound Goal. */
export async function GET(
  request: Request,
  context: PlanningProjectRouteContext,
): Promise<Response> {
  const { goalId } = await context.params;
  return await handlePlanningProjectListRequest(
    request,
    goalId,
    process.env,
    fetch,
  );
}

/** Creates a Project below the authenticated, route-bound Goal. */
export async function POST(
  request: Request,
  context: PlanningProjectRouteContext,
): Promise<Response> {
  const { goalId } = await context.params;
  return await handlePlanningProjectCreateRequest(
    request,
    goalId,
    process.env,
    fetch,
  );
}
