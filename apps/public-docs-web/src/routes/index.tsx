import { createFileRoute, Navigate } from "@tanstack/react-router";
import { docsRoute } from "@/lib/shared";

export const Route = createFileRoute("/")({
	component: IndexRedirect,
});

function IndexRedirect() {
	return <Navigate replace to={docsRoute} />;
}
