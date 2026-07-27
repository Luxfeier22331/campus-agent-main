import {
	Client,
	Connection,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionStatusName,
} from "@temporalio/client";
import { canonicalJsonSha256Digest } from "ingest-core";
import type { IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskExecutionSnapshot } from "./types";
import {
	ingestionTaskWorkflow,
	internalPortalFileReleaseWorkflow,
} from "./workflows/ingestion-task-workflow";

const TEMPORAL_READINESS_TIMEOUT_MS = 4_000;
const TEMPORAL_REQUEST_TIMEOUT_MS = 5_000;

export interface IngestionWorkflowStartResult {
	alreadyStarted: boolean;
	workflowId: string;
	workflowRunId: string | null;
	workflowStatus: WorkflowExecutionStatusName;
}

export interface InternalPortalFileReleaseWorkflowStatus {
	workflowId: string;
	workflowRunId: string;
	workflowStatus: WorkflowExecutionStatusName;
}

export interface IngestionTaskStartMetadata {
	createdBy: string;
	retryOfTaskId?: string | null;
}

export interface IngestionWorkflowStarter {
	getInternalPortalFileReleaseStatuses?(
		workflowIds: string[],
	): Promise<InternalPortalFileReleaseWorkflowStatus[]>;
	startInternalPortalFileRelease?(input: {
		createdBy: string;
		fileReleaseId: number;
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
		async getInternalPortalFileReleaseStatuses(workflowIds) {
			return await connection.withDeadline(
				Date.now() + TEMPORAL_REQUEST_TIMEOUT_MS,
				async () =>
					await Promise.all(
						workflowIds.map(async (workflowId) => {
							const description = await client.workflow.getHandle(workflowId).describe();
							return {
								workflowId,
								workflowRunId: description.runId,
								workflowStatus: description.status.name,
							};
						}),
					),
			);
		},
		async startInternalPortalFileRelease(startInput) {
			assertRequestId(startInput.requestId);
			assertFileReleaseId(startInput.fileReleaseId);
			if (!startInput.createdBy.trim()) {
				throw new Error("internal portal file-release createdBy is required");
			}
			const workflowId = internalPortalFileReleaseWorkflowId(
				startInput.requestId,
				startInput.fileReleaseId,
			);
			try {
				const handle = await connection.withDeadline(Date.now() + TEMPORAL_REQUEST_TIMEOUT_MS, () =>
					client.workflow.start(internalPortalFileReleaseWorkflow, {
						args: [
							{
								fileReleaseId: startInput.fileReleaseId,
								sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
							},
						],
						memo: { created_by: startInput.createdBy },
						taskQueue: config.workflowTaskQueue,
						workflowId,
						workflowIdReusePolicy: "REJECT_DUPLICATE",
					}),
				);
				return {
					alreadyStarted: false,
					workflowId: handle.workflowId,
					workflowRunId: readFirstExecutionRunId(handle),
					workflowStatus: "RUNNING" as const,
				};
			} catch (error) {
				if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
					throw error;
				}
				const description = await connection.withDeadline(
					Date.now() + TEMPORAL_REQUEST_TIMEOUT_MS,
					() => client.workflow.getHandle(workflowId).describe(),
				);
				return {
					alreadyStarted: true,
					workflowId,
					workflowRunId: description.runId,
					workflowStatus: description.status.name,
				};
			}
		},
		async startTask(snapshot, metadata): Promise<IngestionWorkflowStartResult> {
			if (!metadata.createdBy.trim()) {
				throw new Error("ingestion task createdBy is required");
			}
			const workflowId = ingestionWorkflowId(snapshot.task.task_id);
			const snapshotDigest = canonicalJsonSha256Digest(snapshot);
			try {
				const handle = await connection.withDeadline(Date.now() + TEMPORAL_REQUEST_TIMEOUT_MS, () =>
					client.workflow.start(ingestionTaskWorkflow, {
						args: [
							{
								controlActivityTaskQueue: config.controlActivityTaskQueue,
								createdBy: metadata.createdBy,
								retryOfTaskId: metadata.retryOfTaskId ?? null,
								rustKernelActivityTaskQueue: config.rustKernelActivityTaskQueue,
								snapshot,
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
						Date.now() + TEMPORAL_REQUEST_TIMEOUT_MS,
						() => client.workflow.getHandle(workflowId).describe(),
					);
					if (readMemoString(description, "canonical_snapshot_digest") !== snapshotDigest) {
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

export function ingestionWorkflowId(taskId: string): string {
	return `ingestion/${taskId}`;
}

export function internalPortalFileReleaseWorkflowId(
	requestId: string,
	fileReleaseId: number,
): string {
	assertRequestId(requestId);
	assertFileReleaseId(fileReleaseId);
	return `ingestion/internal-portal-file-release/${requestId}/${fileReleaseId}`;
}

function assertRequestId(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new Error("internal portal file-release requestId is invalid");
	}
}

function assertFileReleaseId(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("internal portal fileReleaseId must be a positive safe integer");
	}
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

function readFirstExecutionRunId(handle: unknown): string | null {
	if (!handle || typeof handle !== "object" || !("firstExecutionRunId" in handle)) {
		return null;
	}
	const value = handle.firstExecutionRunId;
	return typeof value === "string" && value.trim() ? value : null;
}
