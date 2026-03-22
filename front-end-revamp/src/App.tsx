import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import AuthLoadingScreen from "@/components/AuthLoadingScreen";
import { useAuth } from "@/contexts/AuthContext";
import SwarmLayout from "@/layouts/SwarmLayout";
import NewSessionPage from "@/pages/NewSessionPage";
import SessionDashboardPage from "@/pages/SessionDashboardPage";
import SessionHistoryPage from "@/pages/SessionHistoryPage";
import SwarmSettingsPage from "@/pages/SwarmSettingsPage";
import ExportPage from "@/pages/ExportPage";
import LandingPage from "@/pages/LandingPage";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";

const ProtectedRoute = () => {
  const { user, isPending } = useAuth();

  if (isPending) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  return <Outlet />;
};

const PublicOnlyRoute = () => {
  const { user, isPending } = useAuth();

  if (isPending) {
    return <AuthLoadingScreen />;
  }

  if (user) {
    return <Navigate to="/swarm" replace />;
  }

  return <Outlet />;
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<Navigate to="/" replace />} />
      <Route element={<PublicOnlyRoute />}>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/swarm" element={<SwarmLayout />}>
          <Route index element={<NewSessionPage />} />
          <Route path="session/:threadId" element={<SessionDashboardPage />} />
          <Route path="history" element={<SessionHistoryPage />} />
          <Route path="settings" element={<SwarmSettingsPage />} />
          <Route path="export/:threadId" element={<ExportPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
