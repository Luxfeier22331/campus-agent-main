import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createIngestionTaskExecutionSnapshot,
	type IngestionTaskRegistryCatalog,
	parseIngestionTaskEnvelope,
	parseIngestionWorkflowStatus,
} from "ingest-core";
import { internalPortalReleaseStreamId } from "./publication-activities";
import {
	IngestionWorkflowIdentityConflictError,
	type IngestionWorkflowStarter,
} from "./temporal-client";
import type { IngestionTaskStore, OfflineReleaseStore } from "./types";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

export interface IngestionControlServiceTokens {
	adminToken?: string | null;
	opsToken?: string | null;
}

export function createIngestionControlHandler(input: {
	store: IngestionTaskStore;
	registryCatalog: IngestionTaskRegistryCatalog;
	readinessCheck?: () => Promise<void>;
	releaseStore?: OfflineReleaseStore;
	serviceTokens?: IngestionControlServiceTokens;
	siteId?: string;
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
				url.pathname === "/internal/ingestion/operations/internal-portal"
			) {
				requireToken(request, tokens.ops, "ops");
				if (
					!(
						input.workflowStarter?.getInternalPortalAuthMaintenanceStatus &&
						input.workflowStarter.getInternalPortalNoticePublicationStatus
					)
				) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const [authMaintenance, noticePublication, noticeRelease, fileRelease] = await Promise.all([
					input.workflowStarter.getInternalPortalAuthMaintenanceStatus(),
					input.workflowStarter.getInternalPortalNoticePublicationStatus(),
					readReleaseStatus(input, "notice"),
					readReleaseStatus(input, "file_release"),
				]);
				return jsonResponse({
					auth_maintenance: authMaintenance,
					file_release: fileRelease,
					notice: { publication: noticePublication, release: noticeRelease },
					schema_version: "internal_portal_ingestion_status.v1",
				});
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
				url.pathname === "/internal/ingestion/operations/internal-portal/notice-publication/pause"
			) {
				requireToken(request, tokens.ops, "ops");
				requireOperatorId(request);
				if (!input.workflowStarter?.pauseInternalPortalNoticePublication) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				return jsonResponse(await input.workflowStarter.pauseInternalPortalNoticePublication());
			}
			if (
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal/notice-publication/resume"
			) {
				requireToken(request, tokens.ops, "ops");
				requireOperatorId(request);
				if (!input.workflowStarter?.resumeInternalPortalNoticePublication) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				return jsonResponse(await input.workflowStarter.resumeInternalPortalNoticePublication());
			}
			if (
				request.method === "POST" &&
				url.pathname ===
					"/internal/ingestion/operations/internal-portal/notice-publication/reconcile"
			) {
				requireToken(request, tokens.ops, "ops");
				const createdBy = requireOperatorId(request);
				if (!input.workflowStarter?.startInternalPortalNoticeReconcile) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const body = await readJsonObject(request);
				assertOnlyKeys(body, ["request_id"]);
				const requestId = requiredRequestId(body.request_id);
				const started = await input.workflowStarter.startInternalPortalNoticeReconcile({
					createdBy,
					requestId,
				});
				return jsonResponse(publicationStartResponse(started, requestId), 202);
			}
			if (
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal/file-releases"
			) {
				requireToken(request, tokens.ops, "ops");
				const createdBy = requireOperatorId(request);
				if (!input.workflowStarter?.startInternalPortalFileRelease) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const body = await readJsonObject(request);
				const requestId = requiredRequestId(body.request_id);
				const ids = requiredFileReleaseIds(body.file_release_ids);
				const workflows = await Promise.all(
					ids.map(async (fileReleaseId) => ({
						file_release_id: fileReleaseId,
						...(await input.workflowStarter?.startInternalPortalFileRelease?.({
							createdBy,
							fileReleaseId,
							requestId: `${requestId}:${fileReleaseId}`,
						})),
					})),
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
			if (
				request.method === "POST" &&
				url.pathname === "/internal/ingestion/operations/internal-portal-auth-maintenance/validate"
			) {
				requireToken(request, tokens.ops, "ops");
				requireOperatorId(request);
				if (!input.workflowStarter?.validateInternalPortalAuthentication) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				return jsonResponse(
					await input.workflowStarter.validateInternalPortalAuthentication(),
					202,
				);
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
				const started = await input.workflowStarter.startTask(snapshot, {
					createdBy: "admin-api",
				});
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
				requireToken(request, tokens.ops, "ops");
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
				requireToken(request, tokens.ops, "ops");
				const task = await input.store.getTask(parseTaskPathId(opsTaskMatch[1]));
				return task ? jsonResponse(task) : jsonResponse({ error: "not_found" }, 404);
			}
			const retryTaskMatch = url.pathname.match(
				/^\/internal\/ingestion\/operations\/tasks\/([^/]+)\/retry$/u,
			);
			if (request.method === "POST" && retryTaskMatch) {
				requireToken(request, tokens.ops, "ops");
				const createdBy = requireOperatorId(request);
				if (!input.workflowStarter) {
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
				if (previous.pipeline_workflow_id) {
					return jsonResponse({ error: "ingestion_pipeline_task_retry_unsupported" }, 409);
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
				const started = await input.workflowStarter.startTask(snapshot, {
					createdBy,
					retryOfTaskId: previous.task_id,
				});
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
				requireToken(request, tokens.admin, "admin");
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

function parseLimit(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) ? parsed : null;
}

function parseTaskPathId(value: string): string {
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

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
	const allowed = new Set(allowedKeys);
	const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
	if (unexpected.length > 0) {
		throw new Error(`request body contains unsupported fields: ${unexpected.join(", ")}`);
	}
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

function publicationStartResponse(
	started: Awaited<
		ReturnType<NonNullable<IngestionWorkflowStarter["startInternalPortalNoticeReconcile"]>>
	>,
	requestId: string,
) {
	return {
		already_started: started.alreadyStarted,
		request_id: requestId,
		temporal_status: started.workflowStatus,
		workflow_id: started.workflowId,
		workflow_run_id: started.workflowRunId,
	};
}

async function readReleaseStatus(
	input: { releaseStore?: OfflineReleaseStore; siteId?: string },
	surface: "file_release" | "notice",
) {
	if (!(input.releaseStore && input.siteId)) {
		return null;
	}
	const streamId = internalPortalReleaseStreamId(input.siteId, surface);
	const [stream, release] = await Promise.all([
		input.releaseStore.getStream(streamId),
		input.releaseStore.getCurrentRelease(streamId),
	]);
	if (!stream) {
		return null;
	}
	return {
		checkpoint: stream.checkpoint,
		current_release_id: stream.current_release_id,
		item_count: release?.item_count ?? null,
		last_added_count: stream.last_added_count,
		last_check_at: stream.last_check_at,
		last_check_error_code: stream.last_check_error_code,
		last_check_mode: stream.last_check_mode,
		last_check_outcome: stream.last_check_outcome,
		last_committed_at: release?.committed_at ?? null,
		last_published_at: stream.last_published_at,
		last_reconcile_at: stream.last_reconcile_at,
		last_updated_count: stream.last_updated_count,
		last_withdrawn_count: stream.last_withdrawn_count,
		stream_id: stream.stream_id,
		version: stream.version,
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
