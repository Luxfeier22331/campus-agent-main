import { parseTaskStatus } from "./projection";
import type { IngestionTaskRegistryCatalog } from "./task-registry";
import type { IngestionTaskEnvelope, IngestionTaskStore } from "./types";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

export function createIngestionControlHandler(input: {
	store: IngestionTaskStore;
	registryCatalog: IngestionTaskRegistryCatalog;
}): IngestionControlHandler {
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const pathname = url.pathname;
		try {
			if (request.method === "POST" && pathname === "/internal/ingestion/tasks") {
				const task = (await request.json()) as IngestionTaskEnvelope;
				input.registryCatalog.requireTask(task);
				return jsonResponse(await input.store.admitTask(task));
			}
			if (
				request.method === "GET" &&
				pathname === "/internal/ingestion/operator-projection/tasks"
			) {
				return jsonResponse(
					await input.store.listOperatorTaskProjections({
						collection: url.searchParams.get("collection"),
						corpus: url.searchParams.get("corpus"),
						limit: parseLimit(url.searchParams.get("limit")),
						runId: url.searchParams.get("run_id") ?? url.searchParams.get("runId"),
						status: parseTaskStatus(url.searchParams.get("status")),
					}),
				);
			}
			const getTaskMatch = pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)$/u);
			if (request.method === "GET" && getTaskMatch) {
				const task = await input.store.getTask(getTaskMatch[1]);
				return task ? jsonResponse(task) : jsonResponse({ error: "not_found" }, 404);
			}
			if (request.method === "GET" && pathname === "/healthz") {
				return jsonResponse({ status: "ok" });
			}
			if (request.method === "GET" && pathname === "/readyz") {
				return jsonResponse({ status: "ready" });
			}
			return jsonResponse({ error: "not_found" }, 404);
		} catch (error) {
			return jsonResponse(
				{ error: error instanceof Error ? error.message : "ingestion control request failed" },
				400,
			);
		}
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function parseLimit(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}
