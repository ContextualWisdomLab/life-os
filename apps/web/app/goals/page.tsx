import { GoalsClient } from './goals-client';

/** Serves the first-party `/goals` route through the authenticated Goals client. */
export default function GoalsPage() {
  return <GoalsClient />;
}
