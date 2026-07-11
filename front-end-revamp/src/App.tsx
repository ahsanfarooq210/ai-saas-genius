import { Navigate, Route, Routes } from "react-router-dom";

import {
  RedirectIfAuthenticated,
  RequireAuth,
} from "@/features/auth/route-guards";
import { ArchitecturePage } from "@/pages/ArchitecturePage";
import { DashboardHomePage } from "@/pages/DashboardHomePage";
import { DiagramsPage } from "@/pages/DiagramsPage";
import { DocumentationPage } from "@/pages/DocumentationPage";
import { LoginPage } from "@/pages/LoginPage";
import { NewArchitecturePage } from "@/pages/NewArchitecturePage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { ProjectLandingPage } from "@/pages/ProjectLandingPage";
import { ProjectOverviewPage } from "@/pages/ProjectOverviewPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ReviewsPage } from "@/pages/ReviewsPage";
import { RuntimePage } from "@/pages/RuntimePage";
import { SignupPage } from "@/pages/SignupPage";
import { RevisionsPage } from "@/pages/RevisionsPage";
import { ProjectWorkspaceRoute } from "@/features/projects/ProjectWorkspaceRoute";

function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard">
          <Route index element={<DashboardHomePage />} />
          <Route path="new" element={<NewArchitecturePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:threadId" element={<ProjectWorkspaceRoute />}>
            <Route index element={<ProjectLandingPage />} />
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="architecture" element={<ArchitecturePage />} />
            <Route path="diagrams" element={<DiagramsPage />} />
            <Route path="documentation" element={<DocumentationPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="revisions" element={<RevisionsPage />} />
            <Route path="runtime" element={<RuntimePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
