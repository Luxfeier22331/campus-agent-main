import {
	Client,
	Connection,
	type ScheduleDescription,
	ScheduleNotFoundError,
	ScheduleOverlapPolicy,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionStatusName,
} from "@temporalio/client";
import { canonicalJsonSha256Digest } from "ingest-core";
import {
	INTERNAL_PORTAL_AUTH_SCHEDULE_ID,
	type InternalPortalAuthMaintenanceFailureDetails,
	type InternalPortalAuthMaintenanceStatus,
	parseInternalPortalAuthMaintenanceResult,
} from "./internal-portal-auth-maintenance";
import {
	INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_RESUME_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
	type InternalPortalNoticePublicationStatus,
} from "./internal-portal-publication";
import type { IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskExecutionSnapshot } from "./types";
import {
	type InternalPortalPublicationWorkflowResult,
	ingestionTaskWorkflow,
	internalPortalFileReleasePublicationWorkflow,
	internalPortalNoticePublicationWorkflow,
} from "./workflows/ingestion-task-workflow";

const TEMPORAL_READINESS_TIMEOUT_MS = 4_000;
const TEMPORAL_START_TIMEOUT_MS = 5_000;

export interface IngestionWorkflowStartResult {
	alreadyStarted: boolean;
	workflowId: string;
	workflowRunId: string | null;
	workflowStatus: WorkflowExecutionStatusName;
}

export interface IngestionTaskStartMetadata {
	createdBy: string;
	pipelineWorkflowId?: string | null;
	retryOfTaskId?: string | null;
}

export interface IngestionWorkflowStarter {
	getInternalPortalAuthMaintenanceStatus?(): Promise<InternalPortalAuthMaintenanceStatus>;
	validateInternalPortalAuthentication?(): Promise<InternalPortalAuthMaintenanceStatus>;
	getInternalPortalNoticePublicationStatus?(): Promise<InternalPortalNoticePublicationStatus>;
	pauseInternalPortalNoticePublication?(): Promise<InternalPortalNoticePublicationStatus>;
	resumeInternalPortalNoticePublication?(): Promise<InternalPortalNoticePublicationStatus>;
	startInternalPortalFileRelease?(input: {
		createdBy: string;
		fileReleaseId: number;
		requestId: string;
	}): Promise<IngestionWorkflowStartResult>;
	startInternalPortalNoticeReconcile?(input: {
		createdBy: string;
		requestId: string;
	}): Promise<IngestionWorkflowStartResult>;
	startTask(
		snapshot: IngestionTaskExecutionSnapshot,
		metadata: IngestionTaskStartMetadata,
	): Promise<IngestionWorkflowStartResult>;
}

export class IngestionWorkflowIdentityConflictError extends Error {
	readonly taskId: string;
	readonly workflowId: string;

	constructor(workflowId: string, taskId: string) {
		super(`ingestion workflow snapshot conflicts with existing workflow: ${workflowId}`);
		this.name = "IngestionWorkflowIdentityConflictError";
		this.taskId = taskId;
		this.workflowId = workflowId;
	}
}

export interface ClosableIngestionWorkflowStarter extends IngestionWorkflowStarter {
	checkReady(): Promise<void>;
	close(): Promise<void>;
}

export async function createTemporalIngestionWorkflowStarter(
	config: IngestionTemporalConfig,
): Promise<ClosableIngestionWorkflowStarter> {
	const connection = await Connection.connect({ address: config.address });
	const client = new Client({ connection, namespace: config.namespace });
	return {
		async checkReady(): Promise<void> {
			await connection.withDeadline(Date.now() + TEMPORAL_READINESS_TIMEOUT_MS, () =>
				connection.workflowService.getSystemInfo({}),
			);
		},
		async close(): Promise<void> {
			await connection.close();
		},
		async getInternalPortalAuthMaintenanceStatus() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, () =>
				readInternalPortalAuthMaintenanceStatus(client),
			);
		},
		async validateInternalPortalAuthentication() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, async () => {
				const handle = client.schedule.getHandle(INTERNAL_PORTAL_AUTH_SCHEDULE_ID);
				await handle.unpause("credential validation requested through Ops Web");
				await handle.trigger(ScheduleOverlapPolicy.SKIP);
				return await readInternalPortalAuthMaintenanceStatus(client);
			});
		},
		async getInternalPortalNoticePublicationStatus() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, () =>
				readInternalPortalNoticePublicationStatus(client),
			);
		},
		async pauseInternalPortalNoticePublication() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, async () => {
				const handle = client.schedule.getHandle(INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID);
				await handle.pause(INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE);
				return await readInternalPortalNoticePublicationStatus(client);
			});
		},
		async resumeInternalPortalNoticePublication() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, async () => {
				const handle = client.schedule.getHandle(INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID);
				await handle.unpause(INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_RESUME_NOTE);
				return await readInternalPortalNoticePublicationStatus(client);
			});
		},
		async startInternalPortalFileRelease(startInput) {
			return await startPublicationWorkflow({
				client,
				connection,
				input: {
					controlActivityTaskQueue: config.controlActivityTaskQueue,
					createdBy: startInput.createdBy,
					fileReleaseId: startInput.fileReleaseId,
					rustKernelActivityTaskQueue: config.rustKernelActivityTaskQueue,
					sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
				},
				requestId: startInput.requestId,
				workflow: internalPortalFileReleasePublicationWorkflow,
				workflowId: `ingestion/internal-portal-file-release/${startInput.requestId}`,
				workflowTaskQueue: config.workflowTaskQueue,
			});
		},
		async startInternalPortalNoticeReconcile(startInput) {
			return await startPublicationWorkflow({
				client,
				connection,
				input: {
					collectionMode: "reconcile",
					controlActivityTaskQueue: config.controlActivityTaskQueue,
					createdBy: startInput.createdBy,
					maxNotices: null,
					overlapPages: 1,
					rustKernelActivityTaskQueue: config.rustKernelActivityTaskQueue,
					sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
				},
				requestId: startInput.requestId,
				workflow: internalPortalNoticePublicationWorkflow,
				workflowId: `ingestion/internal-portal-notice-reconcile/${startInput.requestId}`,
				workflowTaskQueue: config.workflowTaskQueue,
			});
		},
		async startTask(snapshot, metadata): Promise<IngestionWorkflowStartResult> {
			if (!metadata.createdBy.trim()) {
				throw new Error("ingestion task createdBy is required");
			}
			const workflowId = ingestionWorkflowId(snapshot.task.task_id);
			const snapshotDigest = canonicalJsonSha256Digest(snapshot);
			try {
				const handle = await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, () =>
					client.workflow.start(ingestionTaskWorkflow, {
						args: [
							{
								controlActivityTaskQueue: config.controlActivityTaskQueue,
								createdBy: metadata.createdBy,
								pipelineWorkflowId: metadata.pipelineWorkflowId ?? null,
								retryOfTaskId: metadata.retryOfTaskId ?? null,
								rustKernelActivityTaskQueue: config.rustKernelActivityTaskQueue,
								snapshot,
								sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
							},
						],
						memo: { canonical_snapshot_digest: snapshotDigest },
						taskQueue: config.workflowTaskQueue,
						workflowId,
						workflowIdReusePolicy: "REJECT_DUPLICATE",
					}),
				);
				return {
					alreadyStarted: false,
					workflowId: handle.workflowId,
					workflowRunId: readFirstExecutionRunId(handle),
					workflowStatus: "RUNNING",
				};
			} catch (error) {
				if (error instanceof WorkflowExecutionAlreadyStartedError) {
					const description = await connection.withDeadline(
						Date.now() + TEMPORAL_START_TIMEOUT_MS,
						() => client.workflow.getHandle(workflowId).describe(),
					);
					if (readSnapshotDigestMemo(description) !== snapshotDigest) {
						throw new IngestionWorkflowIdentityConflictError(workflowId, snapshot.task.task_id);
					}
					return {
						alreadyStarted: true,
						workflowId,
						workflowRunId: description.runId,
						workflowStatus: description.status.name,
					};
				}
				throw error;
			}
		},
	};
}

async function startPublicationWorkflow(input: {
	client: Client;
	connection: Connection;
	input: Parameters<
		| typeof internalPortalFileReleasePublicationWorkflow
		| typeof internalPortalNoticePublicationWorkflow
	>[0];
	requestId: string;
	workflow:
		| typeof internalPortalFileReleasePublicationWorkflow
		| typeof internalPortalNoticePublicationWorkflow;
	workflowId: string;
	workflowTaskQueue: string;
}): Promise<IngestionWorkflowStartResult> {
	if (!(input.requestId.trim() && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.requestId))) {
		throw new Error("internal portal publication requestId is invalid");
	}
	const requestDigest = canonicalJsonSha256Digest(input.input);
	try {
		const handle = await input.connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, () =>
			input.client.workflow.start(
				input.workflow as typeof internalPortalNoticePublicationWorkflow,
				{
					args: [input.input as Parameters<typeof internalPortalNoticePublicationWorkflow>[0]],
					memo: { canonical_publication_request_digest: requestDigest },
					taskQueue: input.workflowTaskQueue,
					workflowId: input.workflowId,
					workflowIdReusePolicy: "REJECT_DUPLICATE",
				},
			),
		);
		return {
			alreadyStarted: false,
			workflowId: handle.workflowId,
			workflowRunId: readFirstExecutionRunId(handle),
			workflowStatus: "RUNNING",
		};
	} catch (error) {
		if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
			throw error;
		}
		const description = await input.connection.withDeadline(
			Date.now() + TEMPORAL_START_TIMEOUT_MS,
			() => input.client.workflow.getHandle(input.workflowId).describe(),
		);
		if (readMemoString(description, "canonical_publication_request_digest") !== requestDigest) {
			throw new Error(`internal portal publication request conflicts: ${input.requestId}`);
		}
		return {
			alreadyStarted: true,
			workflowId: input.workflowId,
			workflowRunId: description.runId,
			workflowStatus: description.status.name,
		};
	}
}

async function readInternalPortalNoticePublicationStatus(
	client: Client,
): Promise<InternalPortalNoticePublicationStatus> {
	let schedule: ScheduleDescription;
	try {
		schedule = await client.schedule
			.getHandle(INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID)
			.describe();
	} catch (error) {
		if (error instanceof ScheduleNotFoundError) {
			return emptyNoticePublicationStatus("MISSING");
		}
		throw error;
	}
	const scheduleState = schedule.state.paused ? ("PAUSED" as const) : ("ACTIVE" as const);
	const nextRunAt = schedule.state.paused
		? null
		: (schedule.info.nextActionTimes[0]?.toISOString() ?? null);
	const latestAction = schedule.info.recentActions.at(-1);
	if (latestAction?.action.type !== "startWorkflow") {
		return { ...emptyNoticePublicationStatus(scheduleState), nextRunAt };
	}
	const workflowId = latestAction.action.workflow.workflowId;
	const workflowRunId = latestAction.action.workflow.firstExecutionRunId;
	const handle = client.workflow.getHandle(workflowId, workflowRunId);
	const description = await handle.describe();
	const base = {
		lastAttemptAt: latestAction.takenAt.toISOString(),
		nextRunAt,
		scheduleState,
		workflowId,
		workflowRunId,
	};
	if (description.status.name === "RUNNING") {
		return {
			...base,
			errorCode: null,
			lastOutcome: "RUNNING",
			lastReleaseId: null,
		};
	}
	try {
		const result = (await handle.result()) as InternalPortalPublicationWorkflowResult;
		if (result?.outcome === "published") {
			return {
				...base,
				errorCode: null,
				lastOutcome: "PUBLISHED",
				lastReleaseId: result.release?.release_id ?? null,
			};
		}
		if (result?.outcome === "unchanged") {
			return {
				...base,
				errorCode: null,
				lastOutcome: "UNCHANGED",
				lastReleaseId: null,
			};
		}
		if (result?.outcome === "deferred") {
			return {
				...base,
				errorCode: result.errorCode,
				lastOutcome: "DEFERRED",
				lastReleaseId: null,
			};
		}
		return {
			...base,
			errorCode: "unknown_publication_result",
			lastOutcome: "UNKNOWN",
			lastReleaseId: null,
		};
	} catch (error) {
		const failure = readFailureType(error);
		return {
			...base,
			errorCode: failure,
			lastOutcome:
				failure === "internal_portal_credential_expired"
					? "CREDENTIAL_EXPIRED"
					: failure === "internal_portal_credential_unavailable"
						? "CREDENTIAL_UNAVAILABLE"
						: "FAILED",
			lastReleaseId: null,
		};
	}
}

function emptyNoticePublicationStatus(
	scheduleState: InternalPortalNoticePublicationStatus["scheduleState"],
): InternalPortalNoticePublicationStatus {
	return {
		errorCode: null,
		lastAttemptAt: null,
		lastOutcome: null,
		lastReleaseId: null,
		nextRunAt: null,
		scheduleState,
		workflowId: null,
		workflowRunId: null,
	};
}

async function readInternalPortalAuthMaintenanceStatus(
	client: Client,
): Promise<InternalPortalAuthMaintenanceStatus> {
	let schedule: ScheduleDescription;
	try {
		schedule = await client.schedule.getHandle(INTERNAL_PORTAL_AUTH_SCHEDULE_ID).describe();
	} catch (error) {
		if (error instanceof ScheduleNotFoundError) {
			return emptyMaintenanceStatus("MISSING");
		}
		throw error;
	}
	const scheduleState = schedule.state.paused ? ("PAUSED" as const) : ("ACTIVE" as const);
	const nextRunAt = schedule.state.paused
		? null
		: (schedule.info.nextActionTimes[0]?.toISOString() ?? null);
	const latestAction = schedule.info.recentActions.at(-1);
	if (latestAction?.action.type !== "startWorkflow") {
		return {
			...emptyMaintenanceStatus(scheduleState),
			nextRunAt,
		};
	}
	const workflowId = latestAction.action.workflow.workflowId;
	const workflowRunId = latestAction.action.workflow.firstExecutionRunId;
	const handle = client.workflow.getHandle(workflowId, workflowRunId);
	const description = await handle.describe();
	const base = {
		nextRunAt,
		scheduleState,
		workflowId,
		workflowRunId,
	};
	if (description.status.name === "RUNNING") {
		return {
			...base,
			errorCode: null,
			lastAttemptAt: latestAction.takenAt.toISOString(),
			lastOutcome: "RUNNING",
			lastSuccessAt: null,
			noticeProbeSucceeded: null,
			portalSessionEstablished: null,
			serviceTicketIssued: null,
		};
	}
	try {
		const result = parseInternalPortalAuthMaintenanceResult(await handle.result());
		if (!result) {
			return unknownMaintenanceStatus(base, latestAction.takenAt.toISOString());
		}
		return {
			...base,
			errorCode: result.errorCode,
			lastAttemptAt: result.startedAt,
			lastOutcome: result.outcome === "success" ? "SUCCESS" : "TRANSIENT_FAILURE",
			lastSuccessAt: result.lastSuccessAt,
			noticeProbeSucceeded: result.noticeProbeSucceeded,
			portalSessionEstablished: result.portalSessionEstablished,
			serviceTicketIssued: result.serviceTicketIssued,
		};
	} catch (error) {
		const failure = readMaintenanceFailure(error);
		if (!failure) {
			return unknownMaintenanceStatus(base, latestAction.takenAt.toISOString());
		}
		return {
			...base,
			errorCode: failure.errorCode,
			lastAttemptAt: failure.startedAt,
			lastOutcome:
				failure.errorCode === "internal_portal_credential_expired"
					? "CREDENTIAL_EXPIRED"
					: "CREDENTIAL_UNAVAILABLE",
			lastSuccessAt: failure.lastSuccessAt,
			noticeProbeSucceeded: false,
			portalSessionEstablished: false,
			serviceTicketIssued: false,
		};
	}
}

function readMaintenanceFailure(
	error: unknown,
): InternalPortalAuthMaintenanceFailureDetails | null {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const candidate = current as {
			cause?: unknown;
			details?: unknown[];
			type?: unknown;
		};
		if (
			candidate.type === "internal_portal_credential_expired" ||
			candidate.type === "internal_portal_credential_unavailable"
		) {
			const details = candidate.details?.[0];
			if (details && typeof details === "object") {
				return details as InternalPortalAuthMaintenanceFailureDetails;
			}
		}
		current = candidate.cause;
	}
	return null;
}

function emptyMaintenanceStatus(
	scheduleState: InternalPortalAuthMaintenanceStatus["scheduleState"],
): InternalPortalAuthMaintenanceStatus {
	return {
		errorCode: null,
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessAt: null,
		nextRunAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		scheduleState,
		serviceTicketIssued: null,
		workflowId: null,
		workflowRunId: null,
	};
}

function unknownMaintenanceStatus(
	base: Pick<
		InternalPortalAuthMaintenanceStatus,
		"nextRunAt" | "scheduleState" | "workflowId" | "workflowRunId"
	>,
	lastAttemptAt: string,
): InternalPortalAuthMaintenanceStatus {
	return {
		...base,
		errorCode: "internal_portal_auth_maintenance_unknown_failure",
		lastAttemptAt,
		lastOutcome: "UNKNOWN",
		lastSuccessAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		serviceTicketIssued: null,
	};
}

function readSnapshotDigestMemo(description: unknown): string | null {
	return readMemoString(description, "canonical_snapshot_digest");
}

function readMemoString(description: unknown, key: string): string | null {
	if (!description || typeof description !== "object" || !("memo" in description)) {
		return null;
	}
	const memo = description.memo;
	if (!memo || typeof memo !== "object" || !(key in memo)) {
		return null;
	}
	const value = (memo as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function readFailureType(error: unknown): string {
	let current: unknown = error;
	let found = "internal_portal_publication_unknown_failure";
	for (let depth = 0; depth < 12 && current && typeof current === "object"; depth += 1) {
		const candidate = current as { cause?: unknown; type?: unknown };
		if (typeof candidate.type === "string" && candidate.type.trim()) {
			found = candidate.type.slice(0, 128);
			if (
				found === "internal_portal_credential_expired" ||
				found === "internal_portal_credential_unavailable"
			) {
				return found;
			}
		}
		current = candidate.cause;
	}
	return found;
}

export function ingestionWorkflowId(taskId: string): string {
	return `ingestion/${taskId}`;
}

function readFirstExecutionRunId(handle: unknown): string | null {
	if (!handle || typeof handle !== "object" || !("firstExecutionRunId" in handle)) {
		return null;
	}
	const value = handle.firstExecutionRunId;
	return typeof value === "string" && value.trim() ? value : null;
}
