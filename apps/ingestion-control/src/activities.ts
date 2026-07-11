import { type IngestionTaskRegistryCatalog, RegistryAdmissionError } from "ingest-core";
import type { OfficialWebExecutionStatusService } from "./official-web-execution-status-service";
import {
	ingestionTaskExecutionErrorCode,
	ingestionTaskExecutionErrorMessage,
	RegistryTaskContractMismatchError,
	RegistryTaskNotDeclaredError,
	RustKernelIdMissingError,
	RustKernelNotRegisteredError,
	type RustKernelRegistry,
	runDeclaredIngestionTask,
	TaskInputRefNotObjectStoreError,
	TsTaskHandlerNotRegisteredError,
	type TsTaskHandlerRegistry,
} from "./task-executor";
import type { IngestionArtifactRef, IngestionTaskRecord, IngestionTaskStore } from "./types";

export interface MarkIngestionTaskRunningInput {
	taskId: string;
	workflowRunId?: string | null;
}

export interface ExecuteIngestionTaskInput {
	taskId: string;
}

export type ExecuteIngestionTaskResult =
	| {
			status: "completed";
			artifactRefs: IngestionArtifactRef[];
	  }
	| {
			status: "failed";
			errorCode: string;
			errorMessage: string;
	  };

export interface CompleteIngestionTaskInput {
	taskId: string;
	artifactRefs?: IngestionArtifactRef[];
}

export interface FailIngestionTaskInput {
	taskId: string;
	errorCode: string;
	errorMessage: string;
}

export interface CancelIngestionTaskInput {
	taskId: string;
	reason: string;
}

export interface IngestionTaskActivities {
	markIngestionTaskRunning(input: MarkIngestionTaskRunningInput): Promise<IngestionTaskRecord>;
	executeIngestionTask(input: ExecuteIngestionTaskInput): Promise<ExecuteIngestionTaskResult>;
	completeIngestionTask(input: CompleteIngestionTaskInput): Promise<IngestionTaskRecord>;
	failIngestionTask(input: FailIngestionTaskInput): Promise<IngestionTaskRecord>;
	cancelIngestionTask(input: CancelIngestionTaskInput): Promise<IngestionTaskRecord>;
}

export function createIngestionTaskActivities(input: {
	officialWebExecutionStatusService?: OfficialWebExecutionStatusService;
	registryCatalog: IngestionTaskRegistryCatalog;
	rustKernels: RustKernelRegistry;
	store: IngestionTaskStore;
	tsHandlers: TsTaskHandlerRegistry;
}): IngestionTaskActivities {
	return {
		async markIngestionTaskRunning(
			activityInput: MarkIngestionTaskRunningInput,
		): Promise<IngestionTaskRecord> {
			const task = await input.store.markTaskRunning(activityInput);
			await maybeUpdateOfficialWebExecutionStatus(input.officialWebExecutionStatusService, task, {
				executionRef: task.workflow_id,
				status: "running",
				updatedAt: task.updated_at,
			});
			return task;
		},
		async executeIngestionTask(
			activityInput: ExecuteIngestionTaskInput,
		): Promise<ExecuteIngestionTaskResult> {
			const task = await requireTask(input.store, activityInput.taskId);
			try {
				const registry = input.registryCatalog.requireRegistry(task);
				const result = await runDeclaredIngestionTask({
					registry,
					rustKernels: input.rustKernels,
					task,
					tsHandlers: input.tsHandlers,
				});
				return { status: "completed", artifactRefs: result.artifactRefs ?? [] };
			} catch (error) {
				if (!isTerminalExecutionError(error)) {
					throw error;
				}
				return {
					status: "failed",
					errorCode: terminalExecutionErrorCode(error),
					errorMessage: ingestionTaskExecutionErrorMessage(error),
				};
			}
		},
		async completeIngestionTask(
			activityInput: CompleteIngestionTaskInput,
		): Promise<IngestionTaskRecord> {
			const task = await input.store.completeTask(activityInput);
			await maybeUpdateOfficialWebExecutionStatus(input.officialWebExecutionStatusService, task, {
				executionRef: task.workflow_id,
				status: "succeeded",
				updatedAt: task.updated_at,
			});
			return task;
		},
		async failIngestionTask(activityInput: FailIngestionTaskInput): Promise<IngestionTaskRecord> {
			const task = await input.store.failTask(activityInput);
			await maybeUpdateOfficialWebExecutionStatus(input.officialWebExecutionStatusService, task, {
				errorCode: activityInput.errorCode,
				errorMessage: activityInput.errorMessage,
				executionRef: task.workflow_id,
				status: "failed",
				updatedAt: task.updated_at,
			});
			return task;
		},
		async cancelIngestionTask(
			activityInput: CancelIngestionTaskInput,
		): Promise<IngestionTaskRecord> {
			return input.store.cancelTask(activityInput);
		},
	};
}

function isTerminalExecutionError(error: unknown): boolean {
	return (
		error instanceof RegistryAdmissionError ||
		error instanceof RegistryTaskNotDeclaredError ||
		error instanceof RegistryTaskContractMismatchError ||
		error instanceof TsTaskHandlerNotRegisteredError ||
		error instanceof RustKernelIdMissingError ||
		error instanceof RustKernelNotRegisteredError ||
		error instanceof TaskInputRefNotObjectStoreError
	);
}

function terminalExecutionErrorCode(error: unknown): string {
	if (error instanceof RegistryAdmissionError) {
		return "registry_admission_failed";
	}
	return ingestionTaskExecutionErrorCode(error);
}

async function requireTask(
	store: IngestionTaskStore,
	taskId: string,
): Promise<IngestionTaskRecord> {
	const task = await store.getTask(taskId);
	if (!task) {
		throw new Error(`ingestion task not found: ${taskId}`);
	}
	return task;
}

async function maybeUpdateOfficialWebExecutionStatus(
	service: OfficialWebExecutionStatusService | undefined,
	task: IngestionTaskRecord,
	payload: {
		errorCode?: string;
		errorMessage?: string;
		executionRef: string;
		status: "running" | "succeeded" | "failed";
		updatedAt: string;
	},
): Promise<void> {
	if (!(service && isOfficialWebSourceTruthMaterializeTask(task))) {
		return;
	}
	await service.updateRunExecutionStatus({
		payload,
		runId: task.run_id,
	});
}

function isOfficialWebSourceTruthMaterializeTask(task: IngestionTaskRecord): boolean {
	return (
		task.source_family === "official_web" &&
		task.source_channel === "official_web" &&
		task.corpus === "official_web" &&
		task.registry_task_id === "source_truth_materialize" &&
		task.task_kind === "source_truth_materialize"
	);
}
