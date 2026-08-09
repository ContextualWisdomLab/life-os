import { handleTodaySyncRequest } from '../../../../today-sync-client';

/** Next.js 15 asynchronous dynamic route context for one local calendar date. */
interface TodayRouteContext {
  params: Promise<{ date: string }>;
}

/** Returns one authenticated workspace Today aggregate. */
export async function GET(
  request: Request,
  context: TodayRouteContext,
): Promise<Response> {
  const { date } = await context.params;
  return await handleTodaySyncRequest(request, date, process.env, fetch);
}

/** Creates or replaces one complete Today aggregate behind explicit preconditions. */
export async function PUT(
  request: Request,
  context: TodayRouteContext,
): Promise<Response> {
  const { date } = await context.params;
  return await handleTodaySyncRequest(request, date, process.env, fetch);
}
