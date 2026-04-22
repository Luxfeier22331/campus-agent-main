import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/favicon.ico")({
	server: {
		handlers: {
			GET() {
				return new Response(null, { status: 204 });
			},
		},
	},
});
