import {
	Client,
	Connection,
	type ScheduleDescription,
	ScheduleNotFoundError,
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
import type { IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskExecutionSnapshot } from "./types";
import { ingestionTaskWorkflow } from "./workflows/ingestion-task-workflow";

const TEMPORAL_READINESS_TIMEOUT_MS = 4_000;
const TEMPORAL_START_TIMEOUT_MS = 5_000;

export interface IngestionWorkflowStartResult {
	alreadyStarted: boolean;
	workflowId: string;
	workflowRunId: string | null;
	workflowStatus: WorkflowExecutionStatusName;
}

export interface IngestionWorkflowStarter {
	getInternalPortalAuthMaintenanceStatus?(): Promise<InternalPortalAuthMaintenanceStatus>;
	resumeInternalPortalAuthMaintenance?(): Promise<InternalPortalAuthMaintenanceStatus>;
	startTask(snapshot: IngestionTaskExecutionSnapshot): Promise<IngestionWorkflowStartResult>;
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
		async resumeInternalPortalAuthMaintenance() {
			return await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, async () => {
				const handle = client.schedule.getHandle(INTERNAL_PORTAL_AUTH_SCHEDULE_ID);
				await handle.unpause("credential replaced through Ops Web");
				return await readInternalPortalAuthMaintenanceStatus(client);
			});
		},
		async startTask(snapshot): Promise<IngestionWorkflowStartResult> {
			const workflowId = ingestionWorkflowId(snapshot.task.task_id);
			const snapshotDigest = canonicalJsonSha256Digest(snapshot);
			try {
				const handle = await connection.withDeadline(Date.now() + TEMPORAL_START_TIMEOUT_MS, () =>
					client.workflow.start(ingestionTaskWorkflow, {
						args: [
							{
								controlActivityTaskQueue: config.controlActivityTaskQueue,
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
	const latestAction = schedule.info.recentActions.at(-1);
	if (latestAction?.action.type !== "startWorkflow") {
		return {
			...emptyMaintenanceStatus(schedule.state.paused ? "PAUSED" : "ACTIVE"),
			nextRunAt: schedule.info.nextActionTimes[0]?.toISOString() ?? null,
		};
	}
	const workflowId = latestAction.action.workflow.workflowId;
	const workflowRunId = latestAction.action.workflow.firstExecutionRunId;
	const handle = client.workflow.getHandle(workflowId, workflowRunId);
	const description = await handle.describe();
	const base = {
		nextRunAt: schedule.info.nextActionTimes[0]?.toISOString() ?? null,
		scheduleState: schedule.state.paused ? ("PAUSED" as const) : ("ACTIVE" as const),
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
	if (!description || typeof description !== "object" || !("memo" in description)) {
		return null;
	}
	const memo = description.memo;
	if (!memo || typeof memo !== "object" || !("canonical_snapshot_digest" in memo)) {
		return null;
	}
	const value = memo.canonical_snapshot_digest;
	return typeof value === "string" && value.trim() ? value : null;
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
