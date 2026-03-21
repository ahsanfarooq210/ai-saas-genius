import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@xyflow/react/dist/style.css";
import App from "./App.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { ThemeProvider } from "next-themes";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
