import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const PublicChatApp = lazy(async () => {
  const module = await import("./public-chat/app");

  return {
    default: module.PublicChatApp,
  };
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Public chat root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={<PublicChatBootFallback />}>
      <PublicChatApp />
    </Suspense>
  </StrictMode>,
);

function PublicChatBootFallback() {
  return (
    <div className="chat-boot-fallback" role="status">
      <div aria-hidden="true" className="chat-boot-fallback__spinner" />
      <span>Loading campus chat...</span>
    </div>
  );
}
