import { ProjectsClient } from './projects-client';

/** Serves the first-party `/projects` route through the authenticated Projects client. */
export default function ProjectsPage() {
  return <ProjectsClient />;
}
