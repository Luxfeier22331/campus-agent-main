import {
	ApplicationFailure,
	CancellationScope,
	isCancellation,
	proxyActivities,
	workflowInfo,
} from "@temporalio/workflow";
import type {
	IngestionProjectionActivities,
	RustKernelActivities,
	SourceCollectorActivities,
} from "../activities";
import {
	type InternalPortalAuthMaintenanceFailureDetails,
	type InternalPortalAuthMaintenanceResult,
	parseInternalPortalAuthMaintenanceResult,
} from "../internal-portal-auth-maintenance";
import type {
	IngestionTaskExecutionSnapshot,
	IngestionTaskRecord,
	IngestionTaskResult,
} from "../types";

export interface IngestionTaskWorkflowInput {
	controlActivityTaskQueue: string;
	rustKernelActivityTaskQueue: string;
	snapshot: IngestionTaskExecutionSnapshot;
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
	const sourceActivities = proxyActivities<SourceCollectorActivities>({
		heartbeatTimeout: "30 seconds",
		retry: { maximumAttempts: 3 },
		startToCloseTimeout: "12 hours",
		taskQueue: input.sourceCollectorActivityTaskQueue,
	});
	const info = workflowInfo();
	return runIngestionTaskWorkflowPlan({
		execute: async () => {
			if (input.snapshot.registry_task.executor_kind !== "source_collector") {
				return rustActivities.executeRustKernelTask(input.snapshot);
			}
			const preparationRef = await projectionActivities.prepareSourceCollectorTask(input.snapshot);
			return sourceActivities.executeSourceCollectorTask(input.snapshot, preparationRef);
		},
		projectionActivities: {
			prepareSourceCollectorTask: projectionActivities.prepareSourceCollectorTask,
			recordIngestionTaskStarted: projectionActivities.recordIngestionTaskStarted,
			completeIngestionTask: terminalProjectionActivities.completeIngestionTask,
			failIngestionTask: terminalProjectionActivities.failIngestionTask,
			cancelIngestionTask: terminalProjectionActivities.cancelIngestionTask,
		},
		snapshot: input.snapshot,
		workflowId: info.workflowId,
		workflowRunId: info.runId,
	});
}

export async function internalPortalAuthMaintenanceWorkflow(input: {
	sourceCollectorActivityTaskQueue: string;
}): Promise<InternalPortalAuthMaintenanceResult> {
	const sourceActivities = proxyActivities<SourceCollectorActivities>({
		retry: {
			backoffCoefficient: 2,
			initialInterval: "5 seconds",
			maximumAttempts: 3,
			maximumInterval: "30 seconds",
		},
		startToCloseTimeout: "2 minutes",
		taskQueue: input.sourceCollectorActivityTaskQueue,
	});
	return await runInternalPortalAuthMaintenance({
		lastResult: workflowInfo().lastResult,
		now: () => new Date().toISOString(),
		refresh: sourceActivities.refreshInternalPortalAuthentication,
	});
}

export async function runInternalPortalAuthMaintenance(input: {
	lastResult?: unknown;
	now: () => string;
	refresh: SourceCollectorActivities["refreshInternalPortalAuthentication"];
}): Promise<InternalPortalAuthMaintenanceResult> {
	const startedAt = input.now();
	const previous = parseInternalPortalAuthMaintenanceResult(input.lastResult);
	try {
		const refreshed = await input.refresh();
		return {
			completedAt: input.now(),
			errorCode: null,
			lastSuccessAt: refreshed.refreshedAt,
			noticeProbeSucceeded: refreshed.noticeProbeSucceeded,
			outcome: "success",
			portalSessionEstablished: refreshed.portalSessionEstablished,
			schemaVersion: "internal_portal_auth_maintenance.v1",
			serviceTicketIssued: refreshed.serviceTicketIssued,
			startedAt,
		};
	} catch (error) {
		const credentialErrorCode = readPortalCredentialFailureType(error);
		if (credentialErrorCode) {
			const details: InternalPortalAuthMaintenanceFailureDetails = {
				errorCode: credentialErrorCode,
				failedAt: input.now(),
				lastSuccessAt: previous?.lastSuccessAt ?? null,
				startedAt,
			};
			throw ApplicationFailure.nonRetryable(
				"internal portal credential maintenance requires operator action",
				credentialErrorCode,
				details,
			);
		}
		return {
			completedAt: input.now(),
			errorCode: "internal_portal_auth_refresh_transient_failure",
			lastSuccessAt: previous?.lastSuccessAt ?? null,
			noticeProbeSucceeded: false,
			outcome: "transient_failure",
			portalSessionEstablished: false,
			schemaVersion: "internal_portal_auth_maintenance.v1",
			serviceTicketIssued: false,
			startedAt,
		};
	}
}

function readPortalCredentialFailureType(
	error: unknown,
): InternalPortalAuthMaintenanceFailureDetails["errorCode"] | null {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
		if (
			current instanceof ApplicationFailure &&
			(current.type === "internal_portal_credential_expired" ||
				current.type === "internal_portal_credential_unavailable")
		) {
			return current.type;
		}
		current = current.cause;
	}
	return null;
}

export async function runIngestionTaskWorkflowPlan(input: {
	execute: () => Promise<IngestionTaskResult>;
	isCancellationError?: (error: unknown) => boolean;
	projectionActivities: IngestionProjectionActivities;
	runNonCancellableCleanup?: <T>(cleanup: () => Promise<T>) => Promise<T>;
	snapshot: IngestionTaskExecutionSnapshot;
	workflowId: string;
	workflowRunId: string;
}): Promise<IngestionTaskRecord> {
	const isCancellationError = input.isCancellationError ?? isCancellation;
	const runNonCancellableCleanup =
		input.runNonCancellableCleanup ?? ((cleanup) => CancellationScope.nonCancellable(cleanup));
	await input.projectionActivities.recordIngestionTaskStarted({
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
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
		if (current instanceof ApplicationFailure && current.type === "invalid_ingestion_task_result") {
			return true;
		}
		current = current.cause;
	}
	return false;
}

function readErrorMessage(error: unknown): string {
	let current: unknown = error;
	let message = "invalid ingestion task result";
	for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
		message = current.message || message;
		current = current.cause;
	}
	return message;
}

function readErrorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
		return error.code.slice(0, 128);
	}
	return "ingestion_activity_failed";
}
