import { Navigate, Route, Routes } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/route-guards'
import { ArchitecturePage } from '@/pages/ArchitecturePage'
import { DashboardHomePage } from '@/pages/DashboardHomePage'
import { DiagramsPage } from '@/pages/DiagramsPage'
import { DocumentationPage } from '@/pages/DocumentationPage'
import { LoginPage } from '@/pages/LoginPage'
import { NewArchitecturePage } from '@/pages/NewArchitecturePage'
import { NewProjectPage } from '@/pages/NewProjectPage'
import { ProjectLandingPage } from '@/pages/ProjectLandingPage'
import { ProjectOverviewPage } from '@/pages/ProjectOverviewPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ReviewsPage } from '@/pages/ReviewsPage'
import { RuntimePage } from '@/pages/RuntimePage'
import { SignupPage } from '@/pages/SignupPage'

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
          <Route path="projects/:threadId" element={<ProjectLandingPage />} />
          <Route
            path="projects/:threadId/overview"
            element={<ProjectOverviewPage />}
          />
          <Route
            path="projects/:threadId/architecture"
            element={<ArchitecturePage />}
          />
          <Route
            path="projects/:threadId/diagrams"
            element={<DiagramsPage />}
          />
          <Route
            path="projects/:threadId/documentation"
            element={<DocumentationPage />}
          />
          <Route
            path="projects/:threadId/reviews"
            element={<ReviewsPage />}
          />
          <Route
            path="projects/:threadId/runtime"
            element={<RuntimePage />}
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
