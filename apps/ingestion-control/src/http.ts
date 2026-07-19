import { createHash, timingSafeEqual } from "node:crypto";
import {
	createIngestionTaskExecutionSnapshot,
	type IngestionTaskRegistryCatalog,
	parseIngestionTaskEnvelope,
} from "ingest-core";
import {
	IngestionWorkflowIdentityConflictError,
	type IngestionWorkflowStarter,
} from "./temporal-client";
import type { IngestionTaskStore } from "./types";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

export interface IngestionControlServiceTokens {
	adminToken?: string | null;
	opsToken?: string | null;
}

export function createIngestionControlHandler(input: {
	store: IngestionTaskStore;
	registryCatalog: IngestionTaskRegistryCatalog;
	readinessCheck?: () => Promise<void>;
	serviceTokens?: IngestionControlServiceTokens;
	workflowStarter?: IngestionWorkflowStarter;
}): IngestionControlHandler {
	const tokens = {
		admin: input.serviceTokens?.adminToken?.trim() || null,
		ops: input.serviceTokens?.opsToken?.trim() || null,
	};
	return async (request): Promise<Response> => {
		const url = new URL(request.url);
		try {
			if (request.method === "GET" && url.pathname === "/healthz") {
				return jsonResponse({ status: "ok" });
			}
			if (request.method === "GET" && url.pathname === "/readyz") {
				try {
					await input.readinessCheck?.();
				} catch {
					return jsonResponse({ status: "unavailable" }, 503);
				}
				return jsonResponse({ status: "ready" });
			}
			if (
				request.method === "GET" &&
				url.pathname === "/internal/ingestion/operations/internal-portal-auth-maintenance"
			) {
				requireToken(request, tokens.ops, "ops");
				if (!input.workflowStarter?.getInternalPortalAuthMaintenanceStatus) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				return jsonResponse(await input.workflowStarter.getInternalPortalAuthMaintenanceStatus());
			}
			if (
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal-auth-maintenance/resume"
			) {
				requireToken(request, tokens.ops, "ops");
				if (!input.workflowStarter?.resumeInternalPortalAuthMaintenance) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				return jsonResponse(await input.workflowStarter.resumeInternalPortalAuthMaintenance());
			}
			if (request.method === "POST" && url.pathname === "/internal/ingestion/tasks") {
				requireToken(request, tokens.admin, "admin");
				if (!input.workflowStarter) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const task = parseIngestionTaskEnvelope(await request.json());
				const snapshot = createIngestionTaskExecutionSnapshot({
					task,
					registryTask: input.registryCatalog.requireTask(task),
				});
				const started = await input.workflowStarter.startTask(snapshot);
				if (started.alreadyStarted) {
					const existing = await input.store.getTask(task.task_id);
					if (existing) {
						return jsonResponse(existing);
					}
					if (started.workflowStatus !== "RUNNING") {
						return jsonResponse(
							{
								error: "ingestion_projection_missing",
								task_id: task.task_id,
								temporal_status: started.workflowStatus,
								workflow_id: started.workflowId,
								workflow_run_id: started.workflowRunId,
							},
							409,
						);
					}
				}
				return jsonResponse(
					{
						schema_version: "ingestion_workflow_start.v1",
						task_id: task.task_id,
						workflow_id: started.workflowId,
						workflow_run_id: started.workflowRunId,
						temporal_status: started.workflowStatus,
						status: "accepted",
					},
					202,
				);
			}
			const taskMatch = url.pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)$/u);
			if (request.method === "GET" && taskMatch) {
				requireToken(request, tokens.admin, "admin");
				const task = await input.store.getTask(taskMatch[1]);
				return task ? jsonResponse(task) : jsonResponse({ error: "not_found" }, 404);
			}
			return jsonResponse({ error: "not_found" }, 404);
		} catch (error) {
			if (error instanceof IngestionWorkflowIdentityConflictError) {
				return jsonResponse(
					{
						error: "ingestion_task_conflict",
						task_id: error.taskId,
						workflow_id: error.workflowId,
					},
					409,
				);
			}
			if (error instanceof IngestionAuthenticationError) {
				return jsonResponse({ error: error.message }, error.status);
			}
			const message = error instanceof Error ? error.message : "ingestion-control request failed";
			const status =
				message.includes("workflow") || message.includes("Temporal") || message.includes("Schedule")
					? 503
					: 400;
			return jsonResponse({ error: message }, status);
		}
	};
}

class IngestionAuthenticationError extends Error {
	readonly status: 401 | 503;

	constructor(message: string, status: 401 | 503) {
		super(message);
		this.status = status;
	}
}

function requireToken(request: Request, configured: string | null, label: string): void {
	if (!configured) {
		throw new IngestionAuthenticationError(`${label} token is not configured`, 503);
	}
	const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
	const supplied = match?.[1]?.trim();
	if (!(supplied && constantTimeEqual(configured, supplied))) {
		throw new IngestionAuthenticationError(`${label} bearer token is required`, 401);
	}
}

function constantTimeEqual(left: string, right: string): boolean {
	return timingSafeEqual(
		createHash("sha256").update(left).digest(),
		createHash("sha256").update(right).digest(),
	);
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
