import {
	ApplicationFailure,
	CancellationScope,
	isCancellation,
	proxyActivities,
	workflowInfo,
} from "@temporalio/workflow";
import type {
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
	InternalPortalFileReleaseCaptureResult,
} from "ingestion-contracts";
import type {
	IngestionProjectionActivities,
	RustKernelActivities,
	SourceCollectorActivities,
} from "../activities";
import type { IngestionTaskRecord } from "../types";

export interface IngestionTaskWorkflowInput {
	controlActivityTaskQueue: string;
	createdBy: string;
	retryOfTaskId: string | null;
	rustKernelActivityTaskQueue: string;
	snapshot: IngestionTaskExecutionSnapshot;
}

export interface InternalPortalFileReleaseWorkflowInput {
	fileReleaseId: number;
	sourceCollectorActivityTaskQueue: string;
}

export async function ingestionTaskWorkflow(
	input: IngestionTaskWorkflowInput,
): Promise<IngestionTaskRecord> {
	const projectionActivities = proxyActivities<IngestionProjectionActivities>({
		retry: { maximumAttempts: 5 },
		startToCloseTimeout: "1 minute",
		taskQueue: input.controlActivityTaskQueue,
	});
	const terminalProjectionActivities = proxyActivities<IngestionProjectionActivities>({
		retry: {
			backoffCoefficient: 2,
			initialInterval: "1 second",
			maximumInterval: "1 minute",
		},
		startToCloseTimeout: "5 minutes",
		taskQueue: input.controlActivityTaskQueue,
	});
	const rustActivities = proxyActivities<RustKernelActivities>({
		heartbeatTimeout: "30 seconds",
		retry: { maximumAttempts: 3 },
		startToCloseTimeout: "2 hours",
		taskQueue: input.rustKernelActivityTaskQueue,
	});
	const info = workflowInfo();
	return runIngestionTaskWorkflowPlan({
		createdBy: input.createdBy,
		execute: async () => await rustActivities.executeRustKernelTask(input.snapshot),
		projectionActivities: {
			recordIngestionTaskStarted: projectionActivities.recordIngestionTaskStarted,
			completeIngestionTask: terminalProjectionActivities.completeIngestionTask,
			failIngestionTask: terminalProjectionActivities.failIngestionTask,
			cancelIngestionTask: terminalProjectionActivities.cancelIngestionTask,
		},
		retryOfTaskId: input.retryOfTaskId,
		snapshot: input.snapshot,
		workflowId: info.workflowId,
		workflowRunId: info.runId,
	});
}

export async function internalPortalFileReleaseWorkflow(
	input: InternalPortalFileReleaseWorkflowInput,
): Promise<InternalPortalFileReleaseCaptureResult> {
	const sourceActivities = proxyActivities<SourceCollectorActivities>({
		heartbeatTimeout: "30 seconds",
		retry: { maximumAttempts: 1 },
		startToCloseTimeout: "12 hours",
		taskQueue: input.sourceCollectorActivityTaskQueue,
	});
	return await sourceActivities.captureInternalPortalFileRelease({
		fileReleaseId: input.fileReleaseId,
	});
}

export async function runIngestionTaskWorkflowPlan(input: {
	createdBy: string;
	execute: () => Promise<IngestionTaskResult>;
	isCancellationError?: (error: unknown) => boolean;
	projectionActivities: IngestionProjectionActivities;
	retryOfTaskId: string | null;
	runNonCancellableCleanup?: <T>(cleanup: () => Promise<T>) => Promise<T>;
	snapshot: IngestionTaskExecutionSnapshot;
	workflowId: string;
	workflowRunId: string;
}): Promise<IngestionTaskRecord> {
	const isCancellationError = input.isCancellationError ?? isCancellation;
	const runNonCancellableCleanup =
		input.runNonCancellableCleanup ?? ((cleanup) => CancellationScope.nonCancellable(cleanup));
	await input.projectionActivities.recordIngestionTaskStarted({
		createdBy: input.createdBy,
		retryOfTaskId: input.retryOfTaskId,
		snapshot: input.snapshot,
		workflowId: input.workflowId,
		workflowRunId: input.workflowRunId,
	});
	let phase: "execute" | "projection" = "execute";
	try {
		const result = await input.execute();
		phase = "projection";
		return await runNonCancellableCleanup(() =>
			input.projectionActivities.completeIngestionTask({
				result,
				snapshot: input.snapshot,
			}),
		);
	} catch (error) {
		if (isCancellationError(error)) {
			await runNonCancellableCleanup(() =>
				input.projectionActivities.cancelIngestionTask({
					taskId: input.snapshot.task.task_id,
					reason: error instanceof Error ? error.message : "ingestion workflow canceled",
				}),
			);
			throw error;
		}
		if (phase === "projection" && isInvalidTaskResultFailure(error)) {
			await runNonCancellableCleanup(() =>
				input.projectionActivities.failIngestionTask({
					taskId: input.snapshot.task.task_id,
					errorCode: "invalid_ingestion_task_result",
					errorMessage: readErrorMessage(error),
				}),
			);
			throw error;
		}
		if (phase === "projection") {
			throw error;
		}
		await runNonCancellableCleanup(() =>
			input.projectionActivities.failIngestionTask({
				taskId: input.snapshot.task.task_id,
				errorCode: readErrorCode(error),
				errorMessage: error instanceof Error ? error.message : "ingestion activity failed",
			}),
		);
		throw error;
	}
}

function isInvalidTaskResultFailure(error: unknown): boolean {
	for (const current of walkFailureChain(error)) {
		if (
			current instanceof ApplicationFailure &&
			(current.type === "invalid_ingestion_task_result" ||
				(current as unknown as { code?: unknown }).code === "invalid_ingestion_task_result")
		) {
			return true;
		}
		if (
			current &&
			typeof current === "object" &&
			((current as { type?: unknown }).type === "invalid_ingestion_task_result" ||
				(current as { code?: unknown }).code === "invalid_ingestion_task_result")
		) {
			return true;
		}
	}
	return false;
}

function readErrorMessage(error: unknown): string {
	let message = "invalid ingestion task result";
	for (const current of walkFailureChain(error)) {
		if (current instanceof Error && current.message) {
			message = current.message;
		}
	}
	return message;
}

function readErrorCode(error: unknown): string {
	for (const current of walkFailureChain(error)) {
		if (current && typeof current === "object") {
			const candidate = current as { code?: unknown; type?: unknown };
			if (typeof candidate.code === "string" && candidate.code.trim()) {
				return candidate.code.slice(0, 128);
			}
			if (typeof candidate.type === "string" && candidate.type.trim()) {
				return candidate.type.slice(0, 128);
			}
		}
	}
	return "ingestion_activity_failed";
}

function walkFailureChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	const pending: unknown[] = [error];
	const seen = new Set<unknown>();
	while (pending.length > 0 && chain.length < 16) {
		const current = pending.shift();
		if (!current || (typeof current !== "object" && typeof current !== "function")) {
			continue;
		}
		if (seen.has(current)) {
			continue;
		}
		seen.add(current);
		chain.push(current);
		const candidate = current as { cause?: unknown; failure?: unknown };
		if (candidate.cause) {
			pending.push(candidate.cause);
		}
		if (candidate.failure) {
			pending.push(candidate.failure);
		}
	}
	return chain;
}
