import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import type { IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskRecord } from "./types";
import { ingestionTaskWorkflow } from "./workflows/ingestion-task-workflow";

export interface IngestionWorkflowStartResult {
	workflowId: string;
	workflowRunId: string | null;
}

export interface IngestionWorkflowStarter {
	startTask(task: IngestionTaskRecord): Promise<IngestionWorkflowStartResult>;
}

export interface ClosableIngestionWorkflowStarter extends IngestionWorkflowStarter {
	close(): Promise<void>;
}

export async function createTemporalIngestionWorkflowStarter(
	config: IngestionTemporalConfig,
): Promise<ClosableIngestionWorkflowStarter> {
	const connection = await Connection.connect({ address: config.address });
	const client = new Client({
		connection,
		namespace: config.namespace,
	});
	return {
		async close(): Promise<void> {
			await connection.close();
		},
		async startTask(task: IngestionTaskRecord): Promise<IngestionWorkflowStartResult> {
			try {
				const handle = await client.workflow.start(ingestionTaskWorkflow, {
					args: [
						{
							controlActivityTaskQueue: config.controlActivityTaskQueue,
							taskId: task.task_id,
						},
					],
					taskQueue: config.workflowTaskQueue,
					workflowId: task.workflow_id,
				});
				return {
					workflowId: handle.workflowId,
					workflowRunId: readFirstExecutionRunId(handle),
				};
			} catch (error) {
				if (isWorkflowAlreadyStartedError(error)) {
					return {
						workflowId: task.workflow_id,
						workflowRunId: null,
					};
				}
				throw error;
			}
		},
	};
}

function readFirstExecutionRunId(handle: unknown): string | null {
	if (!isRecord(handle)) {
		return null;
	}
	const value = handle.firstExecutionRunId;
	return typeof value === "string" && value.trim() ? value : null;
}

export function isWorkflowAlreadyStartedError(error: unknown): boolean {
	return error instanceof WorkflowExecutionAlreadyStartedError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
