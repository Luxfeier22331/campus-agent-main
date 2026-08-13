import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createIngestionTaskExecutionSnapshot,
	type IngestionTaskRegistryCatalog,
	parseIngestionTaskEnvelope,
	parseIngestionWorkflowStatus,
} from "ingest-core";
import {
	IngestionWorkflowIdentityConflictError,
	type IngestionWorkflowStarter,
} from "./temporal-client";
import type { IngestionTaskStore } from "./types";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

export interface IngestionControlServiceTokens {
	internalToken?: string | null;
}

export function createIngestionControlHandler(input: {
	store: IngestionTaskStore;
	registryCatalog: IngestionTaskRegistryCatalog;
	readinessCheck?: () => Promise<void>;
	serviceTokens?: IngestionControlServiceTokens;
	workflowStarter?: IngestionWorkflowStarter;
}): IngestionControlHandler {
	const internalToken = input.serviceTokens?.internalToken?.trim() || null;
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
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal/file-releases/status"
			) {
				requireToken(request, internalToken, "internal");
				const workflowStarter = input.workflowStarter;
				const getFileReleaseStatuses = workflowStarter?.getInternalPortalFileReleaseStatuses;
				if (!getFileReleaseStatuses) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const body = await readJsonObject(request);
				const workflowIds = requiredFileReleaseWorkflowIds(body.workflow_ids);
				return jsonResponse({
					schema_version: "internal_portal_file_release_workflow_statuses.v1",
					workflows: await runIngestionWorkflowOperation(() =>
						getFileReleaseStatuses.call(workflowStarter, workflowIds),
					),
				});
			}
			if (
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal/file-releases"
			) {
				requireToken(request, internalToken, "internal");
				const createdBy = requireOperatorId(request);
				const workflowStarter = input.workflowStarter;
				const startFileRelease = workflowStarter?.startInternalPortalFileRelease;
				if (!startFileRelease) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const body = await readJsonObject(request);
				const requestId = requiredRequestId(body.request_id);
				const ids = requiredFileReleaseIds(body.file_release_ids);
				const workflows = await runIngestionWorkflowOperation(() =>
					Promise.all(
						ids.map(async (fileReleaseId) => ({
							file_release_id: fileReleaseId,
							...(await startFileRelease.call(workflowStarter, {
								createdBy,
								fileReleaseId,
								requestId,
							})),
						})),
					),
				);
				return jsonResponse(
					{
						request_id: requestId,
						schema_version: "internal_portal_file_release_batch_start.v1",
						workflows,
					},
					202,
				);
			}
			if (request.method === "POST" && url.pathname === "/internal/ingestion/tasks") {
				requireToken(request, internalToken, "internal");
				const workflowStarter = input.workflowStarter;
				if (!workflowStarter) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const task = parseIngestionTaskEnvelope(await request.json());
				const snapshot = createIngestionTaskExecutionSnapshot({
					task,
					registryTask: input.registryCatalog.requireTask(task),
				});
				const started = await runIngestionWorkflowOperation(() =>
					workflowStarter.startTask(snapshot, {
						createdBy: "admin-api",
					}),
				);
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
			if (request.method === "GET" && url.pathname === "/internal/ingestion/operations/tasks") {
				requireToken(request, internalToken, "internal");
				return jsonResponse(
					await input.store.listOperatorTaskProjections({
						collection: url.searchParams.get("collection"),
						corpus: url.searchParams.get("corpus"),
						cursor: url.searchParams.get("cursor"),
						limit: parseLimit(url.searchParams.get("limit")),
						registryTaskId: url.searchParams.get("registry_task_id"),
						runId: url.searchParams.get("run_id"),
						sourceChannel: url.searchParams.get("source_channel"),
						sourceFamily: url.searchParams.get("source_family"),
						status: parseIngestionWorkflowStatus(url.searchParams.get("status")),
					}),
				);
			}
			const opsTaskMatch = url.pathname.match(
				/^\/internal\/ingestion\/operations\/tasks\/([^/]+)$/u,
			);
			if (request.method === "GET" && opsTaskMatch) {
				requireToken(request, internalToken, "internal");
				const task = await input.store.getTask(parseTaskPathId(opsTaskMatch[1]));
				return task ? jsonResponse(task) : jsonResponse({ error: "not_found" }, 404);
			}
			const retryTaskMatch = url.pathname.match(
				/^\/internal\/ingestion\/operations\/tasks\/([^/]+)\/retry$/u,
			);
			if (request.method === "POST" && retryTaskMatch) {
				requireToken(request, internalToken, "internal");
				const createdBy = requireOperatorId(request);
				const workflowStarter = input.workflowStarter;
				if (!workflowStarter) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const previous = await input.store.getTask(parseTaskPathId(retryTaskMatch[1]));
				if (!previous) {
					return jsonResponse({ error: "not_found" }, 404);
				}
				if (previous.status === "running") {
					return jsonResponse({ error: "ingestion_task_still_running" }, 409);
				}
				if (previous.status !== "failed" && previous.status !== "canceled") {
					return jsonResponse({ error: "ingestion_task_not_retryable" }, 409);
				}
				const registryTask = input.registryCatalog.requireTaskById(previous.registry_task_id);
				if (
					registryTask.executor_kind !== previous.executor_kind ||
					registryTask.input_contract !== previous.input_contract ||
					registryTask.output_contract !== previous.output_contract
				) {
					return jsonResponse({ error: "ingestion_retry_contract_changed" }, 409);
				}
				const retryId = randomUUID();
				const snapshot = createIngestionTaskExecutionSnapshot({
					registryTask,
					task: {
						input_ref: previous.input_ref,
						registry_task_id: previous.registry_task_id,
						run_id: `retry:${retryId}`,
						schema_version: "ingestion_task_envelope.v3",
						task_id: `retry:${retryId}`,
					},
				});
				const started = await runIngestionWorkflowOperation(() =>
					workflowStarter.startTask(snapshot, {
						createdBy,
						retryOfTaskId: previous.task_id,
					}),
				);
				return jsonResponse(
					{
						retry_of_task_id: previous.task_id,
						task_id: snapshot.task.task_id,
						workflow_id: started.workflowId,
						workflow_run_id: started.workflowRunId,
					},
					202,
				);
			}
			const taskMatch = url.pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)$/u);
			if (request.method === "GET" && taskMatch) {
				requireToken(request, internalToken, "internal");
				const task = await input.store.getTask(parseTaskPathId(taskMatch[1]));
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
			if (error instanceof IngestionWorkflowUnavailableError) {
				return jsonResponse({ error: error.message }, 503);
			}
			return jsonResponse({ error: "ingestion-control request could not be completed" }, 400);
		}
	};
}

class IngestionWorkflowUnavailableError extends Error {
	constructor(cause: unknown) {
		super("ingestion workflow dependency is unavailable", { cause });
		this.name = "IngestionWorkflowUnavailableError";
	}
}

class IngestionAuthenticationError extends Error {
	readonly status: 401 | 503;

	constructor(message: string, status: 401 | 503) {
		super(message);
		this.status = status;
	}
}

async function runIngestionWorkflowOperation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof IngestionWorkflowIdentityConflictError) {
			throw error;
		}
		throw new IngestionWorkflowUnavailableError(error);
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

function parseLimit(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) ? parsed : null;
}

function parseTaskPathId(value: string | undefined): string {
	if (value === undefined) {
		throw new Error("task_id path segment is invalid");
	}
	const decoded = decodeURIComponent(value);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(decoded)) {
		throw new Error("task_id path segment is invalid");
	}
	return decoded;
}

function requireOperatorId(request: Request): string {
	const value = request.headers.get("x-operator-id")?.trim();
	if (!value || value.length > 256 || containsControlCharacter(value)) {
		throw new IngestionAuthenticationError("operator identity is required", 401);
	}
	return value;
}

function containsControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127;
	});
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	const value = await request.json();
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("request body must be a JSON object");
	}
	return value as Record<string, unknown>;
}

function requiredRequestId(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.trim())
	) {
		throw new Error("request_id is invalid");
	}
	return value.trim();
}

function optionalPositiveInteger(value: unknown, label: string, maximum?: number): number | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
	if (maximum !== undefined && Number(value) > maximum) {
		throw new Error(`${label} must not exceed ${maximum}`);
	}
	return Number(value);
}

function requiredFileReleaseIds(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
		throw new Error("file_release_ids must contain between 1 and 50 IDs");
	}
	const ids = value.map((item) => optionalPositiveInteger(item, "file_release_id"));
	if (ids.some((item) => item === null)) {
		throw new Error("file_release_ids must contain positive integers");
	}
	const unique = [...new Set(ids as number[])];
	if (unique.length !== ids.length) {
		throw new Error("file_release_ids must not contain duplicates");
	}
	return unique;
}

function requiredFileReleaseWorkflowIds(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
		throw new Error("workflow_ids must contain between 1 and 50 IDs");
	}
	const ids = value.map((item) => {
		if (
			typeof item !== "string" ||
			!/^ingestion\/internal-portal-file-release\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/[1-9]\d*$/u.test(
				item,
			)
		) {
			throw new Error("workflow_ids contains an invalid file-release workflow ID");
		}
		return item;
	});
	if (new Set(ids).size !== ids.length) {
		throw new Error("workflow_ids must not contain duplicates");
	}
	return ids;
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
