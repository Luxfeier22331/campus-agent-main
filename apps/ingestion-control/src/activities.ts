import { ApplicationFailure, Context } from "@temporalio/activity";
import type { IngestionArtifactRef } from "ingestion-contracts";
import { validateIngestionTaskResult } from "ingestion-contracts";
import type { IngestionObjectStore } from "./object-store";
import {
	type OfficialWebFreshnessService,
	OfficialWebProjectionContractError,
} from "./official-web-freshness";
import {
	IngestionResultArtifactContractError,
	verifyIngestionTaskResultArtifact,
} from "./result-artifact-verification";
import { type RustKernelRegistry, requireRustKernelId } from "./task-executor";
import type {
	IngestionTaskExecutionSnapshot,
	IngestionTaskRecord,
	IngestionTaskResult,
	IngestionTaskStore,
} from "./types";

export interface RecordIngestionTaskStartedInput {
	snapshot: IngestionTaskExecutionSnapshot;
	workflowId: string;
	workflowRunId: string;
}

export interface CompleteIngestionTaskInput {
	result: IngestionTaskResult;
	snapshot: IngestionTaskExecutionSnapshot;
}

export interface FailIngestionTaskInput {
	errorCode: string;
	errorMessage: string;
	taskId: string;
}

export interface CancelIngestionTaskInput {
	reason: string;
	taskId: string;
}

export interface IngestionProjectionActivities {
	prepareSourceCollectorTask(
		snapshot: IngestionTaskExecutionSnapshot,
	): Promise<IngestionArtifactRef | null>;
	recordIngestionTaskStarted(input: RecordIngestionTaskStartedInput): Promise<IngestionTaskRecord>;
	completeIngestionTask(input: CompleteIngestionTaskInput): Promise<IngestionTaskRecord>;
	failIngestionTask(input: FailIngestionTaskInput): Promise<IngestionTaskRecord>;
	cancelIngestionTask(input: CancelIngestionTaskInput): Promise<IngestionTaskRecord>;
}

export interface RustKernelActivities {
	executeRustKernelTask(snapshot: IngestionTaskExecutionSnapshot): Promise<IngestionTaskResult>;
}

export interface SourceCollectorActivities {
	refreshInternalPortalAuthentication(): Promise<{
		noticeProbeSucceeded: true;
		portalSessionEstablished: true;
		refreshedAt: string;
		serviceTicketIssued: true;
	}>;
	executeSourceCollectorTask(
		snapshot: IngestionTaskExecutionSnapshot,
		preparationRef: IngestionArtifactRef | null,
	): Promise<IngestionTaskResult>;
}

export function createIngestionProjectionActivities(input: {
	objectStore: IngestionObjectStore;
	officialWebFreshness?: OfficialWebFreshnessService;
	store: IngestionTaskStore;
}): IngestionProjectionActivities {
	return {
		async prepareSourceCollectorTask(snapshot) {
			if (snapshot.task.registry_task_id !== "official_web.capture") {
				return null;
			}
			if (!input.officialWebFreshness) {
				throw new Error("official-web freshness service is not configured");
			}
			return input.officialWebFreshness.prepareTask(snapshot, Context.current().info.attempt);
		},
		async recordIngestionTaskStarted(activityInput) {
			return input.store.recordTaskStarted(activityInput);
		},
		async completeIngestionTask(activityInput) {
			const validation = validateIngestionTaskResult(activityInput.result);
			if (!validation.ok) {
				throw ApplicationFailure.nonRetryable(
					`invalid ingestion task result: ${validation.errors.join("; ")}`,
					"invalid_ingestion_task_result",
				);
			}
			assertResultMatchesSnapshot(activityInput.result, activityInput.snapshot);
			try {
				await verifyIngestionTaskResultArtifact({
					objectStore: input.objectStore,
					result: activityInput.result,
					snapshot: activityInput.snapshot,
				});
			} catch (error) {
				if (error instanceof IngestionResultArtifactContractError) {
					throw ApplicationFailure.nonRetryable(error.message, "invalid_ingestion_task_result");
				}
				throw error;
			}
			if (activityInput.result.registry_task_id === "official_web.capture") {
				if (!input.officialWebFreshness) {
					throw new Error("official-web freshness service is not configured");
				}
				try {
					await input.officialWebFreshness.projectResult(
						activityInput.result,
						activityInput.snapshot,
					);
				} catch (error) {
					if (error instanceof OfficialWebProjectionContractError) {
						throw ApplicationFailure.nonRetryable(error.message, "invalid_ingestion_task_result");
					}
					throw error;
				}
			}
			return input.store.completeTask({
				result: activityInput.result,
				taskId: activityInput.snapshot.task.task_id,
			});
		},
		async failIngestionTask(activityInput) {
			return input.store.failTask(activityInput);
		},
		async cancelIngestionTask(activityInput) {
			return input.store.cancelTask(activityInput);
		},
	};
}

function assertResultMatchesSnapshot(
	result: IngestionTaskResult,
	snapshot: IngestionTaskExecutionSnapshot,
): void {
	if (
		result.task_id !== snapshot.task.task_id ||
		result.run_id !== snapshot.task.run_id ||
		result.registry_task_id !== snapshot.task.registry_task_id ||
		result.registry_task_id !== snapshot.registry_task.registry_task_id ||
		result.output_contract !== snapshot.registry_task.output_contract
	) {
		throw ApplicationFailure.nonRetryable(
			`ingestion task result identity does not match frozen snapshot: ${snapshot.task.task_id}`,
			"invalid_ingestion_task_result",
		);
	}
}

export function createRustKernelActivities(input: {
	rustKernels: RustKernelRegistry;
}): RustKernelActivities {
	return {
		async executeRustKernelTask(snapshot) {
			const context = Context.current();
			context.heartbeat({ phase: "starting", task_id: snapshot.task.task_id });
			const heartbeat = setInterval(() => {
				context.heartbeat({ phase: "running", task_id: snapshot.task.task_id });
			}, 10_000);
			try {
				return await input.rustKernels.require(requireRustKernelId(snapshot))(snapshot, {
					activityAttempt: context.info.attempt,
					signal: context.cancellationSignal,
				});
			} finally {
				clearInterval(heartbeat);
			}
		},
	};
}
