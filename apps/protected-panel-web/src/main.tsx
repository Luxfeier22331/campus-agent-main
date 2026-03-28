import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ProtectedPanelAdminApp } from "./panel/app";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Protected panel root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ProtectedPanelAdminApp />
  </StrictMode>,
);
