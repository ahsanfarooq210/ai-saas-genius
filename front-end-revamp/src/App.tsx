import { Navigate, Route, Routes } from "react-router-dom";
import SwarmLayout from "@/layouts/SwarmLayout";
import NewSessionPage from "@/pages/NewSessionPage";
import SessionDashboardPage from "@/pages/SessionDashboardPage";
import SessionHistoryPage from "@/pages/SessionHistoryPage";
import SwarmSettingsPage from "@/pages/SwarmSettingsPage";
import ExportPage from "@/pages/ExportPage";
import LandingPage from "@/pages/LandingPage";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<Navigate to="/" replace />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/swarm" element={<SwarmLayout />}>
        <Route index element={<NewSessionPage />} />
        <Route path="session/:threadId" element={<SessionDashboardPage />} />
        <Route path="history" element={<SessionHistoryPage />} />
        <Route path="settings" element={<SwarmSettingsPage />} />
        <Route path="export/:threadId" element={<ExportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
