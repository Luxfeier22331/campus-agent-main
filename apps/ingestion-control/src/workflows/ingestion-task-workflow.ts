import {
	CancellationScope,
	isCancellation,
	proxyActivities,
	workflowInfo,
} from "@temporalio/workflow";

import type { IngestionTaskActivities } from "../activities";
import type { IngestionTaskRecord } from "../types";

export interface IngestionTaskWorkflowInput {
	controlActivityTaskQueue: string;
	taskId: string;
}

export async function ingestionTaskWorkflow(
	input: IngestionTaskWorkflowInput,
): Promise<IngestionTaskRecord> {
	const controlActivities = proxyActivities<IngestionTaskActivities>({
		retry: {
			maximumAttempts: 3,
		},
		startToCloseTimeout: "30 minutes",
		taskQueue: input.controlActivityTaskQueue,
	});
	const info = workflowInfo();
	return runIngestionTaskWorkflowPlan({
		activities: controlActivities,
		taskId: input.taskId,
		workflowRunId: info.runId,
	});
}

export async function runIngestionTaskWorkflowPlan(input: {
	activities: IngestionTaskActivities;
	isCancellationError?: (error: unknown) => boolean;
	runNonCancellableCleanup?: <T>(cleanup: () => Promise<T>) => Promise<T>;
	taskId: string;
	workflowRunId: string;
}): Promise<IngestionTaskRecord> {
	const isCancellationError = input.isCancellationError ?? isCancellation;
	const runNonCancellableCleanup =
		input.runNonCancellableCleanup ?? ((cleanup) => CancellationScope.nonCancellable(cleanup));
	await input.activities.markIngestionTaskRunning({
		taskId: input.taskId,
		workflowRunId: input.workflowRunId,
	});
	let phase: "execute" | "closeout" = "execute";
	try {
		const result = await input.activities.executeIngestionTask({ taskId: input.taskId });
		phase = "closeout";
		if (result.status === "failed") {
			return await input.activities.failIngestionTask({
				taskId: input.taskId,
				errorCode: result.errorCode,
				errorMessage: result.errorMessage,
			});
		}
		return await input.activities.completeIngestionTask({
			taskId: input.taskId,
			artifactRefs: result.artifactRefs,
		});
	} catch (error) {
		if (isCancellationError(error)) {
			return runNonCancellableCleanup(() =>
				input.activities.cancelIngestionTask({
					taskId: input.taskId,
					reason: error instanceof Error ? error.message : "ingestion task workflow canceled",
				}),
			);
		}
		if (phase === "closeout") {
			throw error;
		}
		return input.activities.failIngestionTask({
			taskId: input.taskId,
			errorCode: readErrorCode(error),
			errorMessage: error instanceof Error ? error.message : "ingestion task workflow failed",
		});
	}
}

function readErrorCode(error: unknown): string {
	void error;
	return "ingestion_task_activity_failed";
}
