import {
	ApplicationFailure,
	CancellationScope,
	executeChild,
	isCancellation,
	proxyActivities,
	workflowInfo,
} from "@temporalio/workflow";
import type {
	IngestionProjectionActivities,
	RustKernelActivities,
	SourceCollectorActivities,
	TypeScriptKernelActivities,
} from "../activities";
import {
	type InternalPortalAuthMaintenanceFailureDetails,
	type InternalPortalAuthMaintenanceResult,
	parseInternalPortalAuthMaintenanceResult,
} from "../internal-portal-auth-maintenance";
import type { InternalPortalScheduleActivities } from "../internal-portal-schedule-activities";
import type {
	InternalPortalPublicationActivities,
	InternalPortalPublicationContext,
} from "../publication-activities";
import type {
	IngestionTaskExecutionSnapshot,
	IngestionTaskRecord,
	IngestionTaskResult,
	OfflineReleaseRecord,
	OfflineReleaseStreamRecord,
} from "../types";

export interface IngestionTaskWorkflowInput {
	controlActivityTaskQueue: string;
	createdBy: string;
	pipelineWorkflowId: string | null;
	retryOfTaskId: string | null;
	rustKernelActivityTaskQueue: string;
	snapshot: IngestionTaskExecutionSnapshot;
	sourceCollectorActivityTaskQueue: string;
}

export interface InternalPortalPublicationWorkflowInput {
	controlActivityTaskQueue: string;
	createdBy: string;
	rustKernelActivityTaskQueue: string;
	sourceCollectorActivityTaskQueue: string;
}

export interface InternalPortalNoticePublicationWorkflowInput
	extends InternalPortalPublicationWorkflowInput {
	collectionMode: "reconcile" | "incremental" | "selected";
	maxNotices?: number | null;
	overlapPages: number;
	selectedNotices?: Array<{
		notice_id: number;
		notice_type: string;
		notice_type_name?: string;
		notice_title?: string;
	}>;
}

export interface InternalPortalFileReleasePublicationWorkflowInput
	extends InternalPortalPublicationWorkflowInput {
	fileReleaseId: number;
}

export interface InternalPortalPublicationWorkflowResult {
	errorCode: string | null;
	outcome: "deferred" | "published" | "unchanged";
	release: OfflineReleaseRecord | null;
	stream: OfflineReleaseStreamRecord | null;
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
	const typeScriptActivities = proxyActivities<TypeScriptKernelActivities>({
		heartbeatTimeout: "30 seconds",
		retry: { maximumAttempts: 3 },
		startToCloseTimeout: "2 hours",
		taskQueue: input.controlActivityTaskQueue,
	});
	const info = workflowInfo();
	return runIngestionTaskWorkflowPlan({
		createdBy: input.createdBy,
		execute: async () => {
			if (input.snapshot.registry_task.executor_kind === "rust_kernel") {
				return rustActivities.executeRustKernelTask(input.snapshot);
			}
			if (input.snapshot.registry_task.executor_kind === "typescript_kernel") {
				return typeScriptActivities.executeTypeScriptKernelTask(input.snapshot);
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
		pipelineWorkflowId: input.pipelineWorkflowId,
		retryOfTaskId: input.retryOfTaskId,
		snapshot: input.snapshot,
		workflowId: info.workflowId,
		workflowRunId: info.runId,
	});
}

export async function internalPortalNoticePublicationWorkflow(
	input: InternalPortalNoticePublicationWorkflowInput,
): Promise<InternalPortalPublicationWorkflowResult> {
	const scheduleActivities = proxyActivities<InternalPortalScheduleActivities>({
		retry: { maximumAttempts: 5 },
		startToCloseTimeout: "1 minute",
		taskQueue: input.controlActivityTaskQueue,
	});
	return await runInternalPortalNoticePublicationPlan({
		execute: async () =>
			await runInternalPortalPublicationWorkflow({
				...input,
				fileReleaseId: null,
				maxNotices: input.maxNotices ?? null,
				selectedNotices: input.selectedNotices ?? [],
				surface: "notice",
			}),
		pauseForCredential: scheduleActivities.pauseInternalPortalNoticePublicationForCredential,
	});
}

export async function runInternalPortalNoticePublicationPlan(input: {
	execute: () => Promise<InternalPortalPublicationWorkflowResult>;
	isCancellationError?: (error: unknown) => boolean;
	pauseForCredential?: InternalPortalScheduleActivities["pauseInternalPortalNoticePublicationForCredential"];
}): Promise<InternalPortalPublicationWorkflowResult> {
	try {
		return await input.execute();
	} catch (error) {
		if ((input.isCancellationError ?? isCancellation)(error)) {
			throw error;
		}
		const errorCode = readPublicationFailureCode(error);
		if (
			errorCode === "internal_portal_credential_expired" ||
			errorCode === "internal_portal_credential_unavailable"
		) {
			await input.pauseForCredential?.(errorCode);
			return {
				errorCode,
				outcome: "deferred",
				release: null,
				stream: null,
			};
		}
		if (errorCode !== "internal_portal_source_deferred") {
			throw error;
		}
		return {
			errorCode,
			outcome: "deferred",
			release: null,
			stream: null,
		};
	}
}

export async function internalPortalFileReleasePublicationWorkflow(
	input: InternalPortalFileReleasePublicationWorkflowInput,
): Promise<InternalPortalPublicationWorkflowResult> {
	return await runInternalPortalPublicationWorkflow({
		...input,
		collectionMode: "selected",
		fileReleaseId: input.fileReleaseId,
		maxNotices: null,
		overlapPages: 1,
		selectedNotices: [],
		surface: "file_release",
	});
}

async function runInternalPortalPublicationWorkflow(
	input: InternalPortalPublicationWorkflowInput & {
		collectionMode: "reconcile" | "incremental" | "selected";
		fileReleaseId: number | null;
		maxNotices: number | null;
		overlapPages: number;
		selectedNotices: NonNullable<InternalPortalNoticePublicationWorkflowInput["selectedNotices"]>;
		surface: "file_release" | "notice";
	},
): Promise<InternalPortalPublicationWorkflowResult> {
	const activities = proxyActivities<InternalPortalPublicationActivities>({
		retry: {
			backoffCoefficient: 2,
			initialInterval: "1 second",
			maximumAttempts: 5,
			maximumInterval: "30 seconds",
		},
		startToCloseTimeout: "5 minutes",
		taskQueue: input.controlActivityTaskQueue,
	});
	const info = workflowInfo();
	const context = await activities.prepareInternalPortalPublication({
		collectionMode: input.collectionMode,
		createdBy: input.createdBy,
		fileReleaseId: input.fileReleaseId,
		maxNotices: input.maxNotices,
		overlapPages: input.overlapPages,
		runId: info.runId,
		selectedNotices: input.selectedNotices,
		startedAt: info.startTime.toISOString(),
		surface: input.surface,
		workflowId: info.workflowId,
		workflowRunId: info.runId,
	});
	try {
		const captureTask = await executePublicationChild(context.captureSnapshot, context, input);
		const materializationSnapshot = await activities.prepareInternalPortalMaterialization({
			captureTask,
			context,
		});
		const materializationTask = await executePublicationChild(
			materializationSnapshot,
			context,
			input,
		);
		let validationTask: IngestionTaskRecord | null = null;
		if (input.surface === "notice") {
			const validationSnapshot = await activities.prepareInternalPortalNoticeValidation({
				context,
				materializationTask,
			});
			validationTask = await executePublicationChild(validationSnapshot, context, input);
		}
		const committed = await activities.commitInternalPortalPublication({
			captureTask,
			context,
			materializationTask,
			validationTask,
		});
		return {
			errorCode: null,
			outcome: committed.outcome,
			release: committed.release,
			stream: committed.stream,
		};
	} catch (error) {
		if (isCancellation(error)) {
			throw error;
		}
		const errorCode = readPublicationFailureCode(error);
		await activities.recordInternalPortalPublicationCheck({
			context,
			errorCode,
			outcome:
				errorCode === "internal_portal_source_deferred" ||
				errorCode === "internal_portal_credential_expired" ||
				errorCode === "internal_portal_credential_unavailable"
					? "deferred"
					: "failed",
		});
		throw error;
	}
}

async function executePublicationChild(
	snapshot: IngestionTaskExecutionSnapshot,
	context: InternalPortalPublicationContext,
	queues: InternalPortalPublicationWorkflowInput,
): Promise<IngestionTaskRecord> {
	return executeChild(ingestionTaskWorkflow, {
		args: [
			{
				controlActivityTaskQueue: queues.controlActivityTaskQueue,
				createdBy: context.createdBy,
				pipelineWorkflowId: context.workflowId,
				retryOfTaskId: null,
				rustKernelActivityTaskQueue: queues.rustKernelActivityTaskQueue,
				snapshot,
				sourceCollectorActivityTaskQueue: queues.sourceCollectorActivityTaskQueue,
			},
		],
		workflowId: `ingestion/${snapshot.task.task_id}`,
		workflowIdReusePolicy: "REJECT_DUPLICATE",
	});
}

function readPublicationFailureCode(error: unknown): string {
	let current: unknown = error;
	let found = "internal_portal_publication_failed";
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

export async function internalPortalAuthMaintenanceWorkflow(input: {
	controlActivityTaskQueue: string;
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
	const scheduleActivities = proxyActivities<InternalPortalScheduleActivities>({
		retry: {
			backoffCoefficient: 2,
			initialInterval: "1 second",
			maximumAttempts: 5,
			maximumInterval: "30 seconds",
		},
		startToCloseTimeout: "1 minute",
		taskQueue: input.controlActivityTaskQueue,
	});
	return await runInternalPortalAuthMaintenance({
		activateNoticePublication: scheduleActivities.activateInternalPortalNoticePublication,
		lastResult: workflowInfo().lastResult,
		now: () => new Date().toISOString(),
		refresh: sourceActivities.refreshInternalPortalAuthentication,
	});
}

export async function runInternalPortalAuthMaintenance(input: {
	activateNoticePublication: InternalPortalScheduleActivities["activateInternalPortalNoticePublication"];
	lastResult?: unknown;
	now: () => string;
	refresh: SourceCollectorActivities["refreshInternalPortalAuthentication"];
}): Promise<InternalPortalAuthMaintenanceResult> {
	const startedAt = input.now();
	const previous = parseInternalPortalAuthMaintenanceResult(input.lastResult);
	let refreshed: Awaited<
		ReturnType<SourceCollectorActivities["refreshInternalPortalAuthentication"]>
	>;
	try {
		refreshed = await input.refresh();
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
	try {
		await input.activateNoticePublication();
	} catch {
		return {
			completedAt: input.now(),
			errorCode: "internal_portal_notice_schedule_activation_failed",
			lastSuccessAt: refreshed.refreshedAt,
			noticeProbeSucceeded: refreshed.noticeProbeSucceeded,
			outcome: "transient_failure",
			portalSessionEstablished: refreshed.portalSessionEstablished,
			schemaVersion: "internal_portal_auth_maintenance.v1",
			serviceTicketIssued: refreshed.serviceTicketIssued,
			startedAt,
		};
	}
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
	createdBy: string;
	execute: () => Promise<IngestionTaskResult>;
	isCancellationError?: (error: unknown) => boolean;
	projectionActivities: IngestionProjectionActivities;
	pipelineWorkflowId: string | null;
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
		pipelineWorkflowId: input.pipelineWorkflowId,
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
