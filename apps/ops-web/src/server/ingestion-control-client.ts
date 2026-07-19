import {
	OpsFileReleaseBatchStartSchema,
	type OpsIngestionTask,
	type OpsIngestionTaskList,
	OpsIngestionTaskListSchema,
	type OpsIngestionTaskRetryStart,
	OpsIngestionTaskRetryStartSchema,
	OpsIngestionTaskSchema,
	OpsIngestionWorkflowStartSchema,
	type OpsInternalPortalIngestionStatus,
	OpsInternalPortalIngestionStatusSchema,
	type OpsInternalPortalMaintenanceStatus,
	OpsInternalPortalMaintenanceStatusSchema,
	OpsInternalPortalPublicationStatusSchema,
} from "../shared/ops-contract.ts";

const REQUEST_TIMEOUT_MS = 5_000;
const STATUS_PATH = "/internal/ingestion/operations/internal-portal-auth-maintenance";

export interface IngestionControlEnv {
	OPS_WEB_INTERNAL_TOKEN?: string;
	OPS_WEB_INGESTION_CONTROL_URL?: string;
}

export interface InternalPortalAuthMaintenanceClient {
	getStatus(): Promise<OpsInternalPortalMaintenanceStatus>;
	validate(operatorId: string): Promise<OpsInternalPortalMaintenanceStatus>;
}

export interface IngestionControlClient extends InternalPortalAuthMaintenanceClient {
	getInternalPortalStatus(): Promise<OpsInternalPortalIngestionStatus>;
	getTask(taskId: string): Promise<OpsIngestionTask>;
	listTasks(query: URLSearchParams): Promise<OpsIngestionTaskList>;
	pauseNoticePublication(operatorId: string): Promise<unknown>;
	resumeNoticePublication(operatorId: string): Promise<unknown>;
	retryTask(taskId: string, operatorId: string): Promise<OpsIngestionTaskRetryStart>;
	startFileReleases(input: {
		fileReleaseIds: number[];
		operatorId: string;
		requestId: string;
	}): Promise<unknown>;
	startNoticeReconcile(input: { operatorId: string; requestId: string }): Promise<unknown>;
}

export class IngestionControlUnavailableError extends Error {
	constructor(message = "ingestion control is unavailable", options?: ErrorOptions) {
		super(message, options);
		this.name = "IngestionControlUnavailableError";
	}
}

export class IngestionControlResponseError extends Error {
	readonly status: number;
	readonly upstreamCode: string | null;

	constructor(status: number, upstreamCode: string | null) {
		super(`ingestion-control request returned HTTP ${status}`);
		this.name = "IngestionControlResponseError";
		this.status = status;
		this.upstreamCode = upstreamCode;
	}
}

export function createIngestionControlClientFromEnv(
	env: IngestionControlEnv,
): IngestionControlClient {
	const baseUrl = env.OPS_WEB_INGESTION_CONTROL_URL?.trim().replace(/\/+$/u, "");
	const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();
	if (!(baseUrl && token)) {
		return createUnavailableIngestionControlClient();
	}
	const parsedUrl = new URL(baseUrl);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new IngestionControlUnavailableError("ingestion-control URL must use HTTP or HTTPS");
	}
	const request = async (input: {
		body?: unknown;
		method: "GET" | "POST";
		operatorId?: string;
		path: string;
	}) => {
		let response: Response;
		try {
			response = await fetch(`${baseUrl}${input.path}`, {
				body: input.body === undefined ? undefined : JSON.stringify(input.body),
				headers: {
					authorization: `Bearer ${token}`,
					...(input.body === undefined ? {} : { "content-type": "application/json" }),
					...(input.operatorId ? { "x-operator-id": input.operatorId } : {}),
				},
				method: input.method,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new IngestionControlUnavailableError(undefined, { cause: error });
		}
		if (!response.ok) {
			throw new IngestionControlResponseError(
				response.status,
				await readUpstreamErrorCode(response),
			);
		}
		return await response.json();
	};
	return {
		getStatus: async () =>
			OpsInternalPortalMaintenanceStatusSchema.parse(
				await request({ method: "GET", path: STATUS_PATH }),
			),
		validate: async (operatorId) =>
			OpsInternalPortalMaintenanceStatusSchema.parse(
				await request({
					method: "POST",
					operatorId,
					path: `${STATUS_PATH}/validate`,
				}),
			),
		getInternalPortalStatus: async () =>
			OpsInternalPortalIngestionStatusSchema.parse(
				await request({
					method: "GET",
					path: "/internal/ingestion/operations/internal-portal",
				}),
			),
		getTask: async (taskId) =>
			OpsIngestionTaskSchema.parse(
				await request({
					method: "GET",
					path: `/internal/ingestion/operations/tasks/${encodeURIComponent(taskId)}`,
				}),
			),
		listTasks: async (query) =>
			OpsIngestionTaskListSchema.parse(
				await request({
					method: "GET",
					path: `/internal/ingestion/operations/tasks${query.size > 0 ? `?${query.toString()}` : ""}`,
				}),
			),
		pauseNoticePublication: async (operatorId) =>
			OpsInternalPortalPublicationStatusSchema.parse(
				await request({
					method: "POST",
					operatorId,
					path: "/internal/ingestion/operations/internal-portal/notice-publication/pause",
				}),
			),
		resumeNoticePublication: async (operatorId) =>
			OpsInternalPortalPublicationStatusSchema.parse(
				await request({
					method: "POST",
					operatorId,
					path: "/internal/ingestion/operations/internal-portal/notice-publication/resume",
				}),
			),
		retryTask: async (taskId, operatorId) =>
			OpsIngestionTaskRetryStartSchema.parse(
				await request({
					method: "POST",
					operatorId,
					path: `/internal/ingestion/operations/tasks/${encodeURIComponent(taskId)}/retry`,
				}),
			),
		startFileReleases: async (startInput) =>
			OpsFileReleaseBatchStartSchema.parse(
				await request({
					body: {
						file_release_ids: startInput.fileReleaseIds,
						request_id: startInput.requestId,
					},
					method: "POST",
					operatorId: startInput.operatorId,
					path: "/internal/ingestion/operations/internal-portal/file-releases",
				}),
			),
		startNoticeReconcile: async (startInput) =>
			OpsIngestionWorkflowStartSchema.parse(
				await request({
					body: {
						request_id: startInput.requestId,
					},
					method: "POST",
					operatorId: startInput.operatorId,
					path: "/internal/ingestion/operations/internal-portal/notice-publication/reconcile",
				}),
			),
	};
}

async function readUpstreamErrorCode(response: Response): Promise<string | null> {
	try {
		const value = (await response.json()) as unknown;
		if (value && typeof value === "object" && "error" in value) {
			const error = (value as { error?: unknown }).error;
			return typeof error === "string" && error.trim() ? error.trim() : null;
		}
	} catch {
		return null;
	}
	return null;
}

export function createUnavailableIngestionControlClient(): IngestionControlClient {
	const unavailable = async () => {
		throw new IngestionControlUnavailableError();
	};
	return {
		getStatus: async () => unavailableMaintenanceStatus(),
		getInternalPortalStatus: unavailable,
		getTask: unavailable,
		listTasks: unavailable,
		pauseNoticePublication: unavailable,
		validate: unavailable,
		resumeNoticePublication: unavailable,
		retryTask: unavailable,
		startFileReleases: unavailable,
		startNoticeReconcile: unavailable,
	};
}

export function unavailableMaintenanceStatus(): OpsInternalPortalMaintenanceStatus {
	return {
		errorCode: "internal_portal_auth_maintenance_unavailable",
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessAt: null,
		nextRunAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		scheduleState: "UNAVAILABLE",
		serviceTicketIssued: null,
	};
}
