import {
  handleHabitCreateRequest,
  handleHabitListRequest,
} from '../../habit-client';

/** Lists durable Habits after deriving workspace authority from Identity. */
export async function GET(request: Request): Promise<Response> {
  return await handleHabitListRequest(request, process.env, fetch);
}

/** Creates one durable Habit after deriving workspace authority from Identity. */
export async function POST(request: Request): Promise<Response> {
  return await handleHabitCreateRequest(request, process.env, fetch);
}
