import { Navigate, Route, Routes } from "react-router-dom";
import SwarmLayout from "@/layouts/SwarmLayout";
import NewSessionPage from "@/pages/NewSessionPage";
import SessionDashboardPage from "@/pages/SessionDashboardPage";
import SessionHistoryPage from "@/pages/SessionHistoryPage";
import SwarmSettingsPage from "@/pages/SwarmSettingsPage";
import ExportPage from "@/pages/ExportPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<SwarmLayout />}>
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
