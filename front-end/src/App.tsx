import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import LandingPage from "./pages/LandingPage";
import ConversationPage from "./pages/ConversationPage";
import ImagePage from "./pages/ImagePage";
import VideoPage from "./pages/VideoPage";
import MusicPage from "./pages/MusicPage";
import CodePage from "./pages/CodePage";
import SettingsPage from "./pages/SettingsPage";
import { Toaster } from "react-hot-toast";

function App() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/" element={<DashboardLayout />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="conversation" element={<ConversationPage />} />
          <Route path="image" element={<ImagePage />} />
          <Route path="video" element={<VideoPage />} />
          <Route path="music" element={<MusicPage />} />
          <Route path="code" element={<CodePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
