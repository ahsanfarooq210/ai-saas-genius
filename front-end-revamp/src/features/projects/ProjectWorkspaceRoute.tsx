import { Navigate, Outlet, useParams } from "react-router-dom";

import { ProjectWorkspaceProvider } from "./project-workspace-context";

export function ProjectWorkspaceRoute() {
  const { threadId } = useParams();
  if (!threadId) return <Navigate to="/dashboard/projects" replace />;
  return (
    <ProjectWorkspaceProvider threadId={threadId}>
      <Outlet />
    </ProjectWorkspaceProvider>
  );
}
