import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ProtectedPanelAdminApp } from "./panel/app";
import { PANEL_COPY } from "./panel/panel-copy";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(PANEL_COPY.rootElementMissing);
}

createRoot(rootElement).render(
  <StrictMode>
    <ProtectedPanelAdminApp />
  </StrictMode>,
);
