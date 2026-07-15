import {
	Client,
	Connection,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionStatusName,
} from "@temporalio/client";
import { canonicalJsonSha256Digest } from "ingest-core";
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
