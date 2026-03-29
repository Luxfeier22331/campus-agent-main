import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const ProtectedPanelAdminApp = lazy(async () => {
  const module = await import("./panel/app");

  return {
    default: module.ProtectedPanelAdminApp,
  };
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Protected panel root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={<PanelBootFallback />}>
      <ProtectedPanelAdminApp />
    </Suspense>
  </StrictMode>,
);

function PanelBootFallback() {
  return (
    <div className="panel-boot-fallback" role="status">
      <div className="panel-boot-fallback__spinner" aria-hidden="true" />
      <span>Loading protected panel...</span>
    </div>
  );
}
