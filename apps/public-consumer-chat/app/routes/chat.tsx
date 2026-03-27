import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  component: ChatLayoutRoute,
});

function ChatLayoutRoute() {
  return <Outlet />;
}
