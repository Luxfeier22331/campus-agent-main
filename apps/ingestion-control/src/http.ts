import { parseTaskStatus } from "./projection";
import type { IngestionTaskRegistryCatalog } from "./task-registry";
import type { IngestionArtifactRef, IngestionTaskEnvelope, IngestionTaskStore } from "./types";

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
			if (request.method === "GET" && pathname === "/internal/ingestion/tasks/next") {
				return jsonResponse(await input.store.nextTask());
			}
			if (request.method === "POST" && pathname === "/internal/ingestion/tasks/claim") {
				const body = (await request.json()) as Record<string, unknown>;
				const task = await input.store.claimNextTask({
					workerId: requiredString(body, "worker_id"),
				});
				return task ? jsonResponse(task) : new Response(null, { status: 204 });
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
			const heartbeatMatch = pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)\/heartbeat$/u);
			if (request.method === "POST" && heartbeatMatch) {
				const body = (await request.json()) as Record<string, unknown>;
				return jsonResponse(
					await input.store.heartbeatTask({
						taskId: heartbeatMatch[1],
						workerId: requiredString(body, "worker_id"),
					}),
				);
			}
			const completeMatch = pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)\/complete$/u);
			if (request.method === "POST" && completeMatch) {
				const body = (await request.json()) as Record<string, unknown>;
				return jsonResponse(
					await input.store.completeTask({
						taskId: completeMatch[1],
						workerId: requiredString(body, "worker_id"),
						artifactRefs: normalizeArtifactRefs(body.artifact_refs),
					}),
				);
			}
			const failMatch = pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)\/fail$/u);
			if (request.method === "POST" && failMatch) {
				const body = (await request.json()) as Record<string, unknown>;
				return jsonResponse(
					await input.store.failTask({
						taskId: failMatch[1],
						workerId: requiredString(body, "worker_id"),
						errorCode: requiredString(body, "error_code"),
						errorMessage: requiredString(body, "error_message"),
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

function requiredString(body: Record<string, unknown>, field: string): string {
	const value = body[field];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} is required`);
	}
	return value;
}

function normalizeArtifactRefs(value: unknown): IngestionArtifactRef[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error("artifact_refs must be an array");
	}
	return value.map((item): IngestionArtifactRef => {
		if (!isRecord(item)) {
			throw new Error("artifact_refs entries must be objects");
		}
		return {
			kind: item.kind as IngestionArtifactRef["kind"],
			uri: requiredString(item, "uri"),
			digest: typeof item.digest === "string" ? item.digest : undefined,
		};
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
