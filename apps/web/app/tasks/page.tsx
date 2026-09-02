import { TasksClient } from './tasks-client';

/** Serves the first-party `/tasks` route through the authenticated Tasks client. */
export default function TasksPage() {
  return <TasksClient />;
}
