import { ApplicationFailure } from "@temporalio/workflow";
import { describe, expect, it, vi } from "vitest";
import type { IngestionProjectionActivities } from "../src/activities";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import {
	runIngestionTaskWorkflowPlan,
	runInternalPortalNoticePublicationPlan,
} from "../src/workflows/ingestion-task-workflow";
import { testResult, testSnapshot, testTaskStartMetadata } from "./fixtures";

describe("ingestion task workflow", () => {
	it("records start, executes one activity and projects one result", async () => {
		const calls: string[] = [];
		const store = new InMemoryIngestionTaskStore();
		const projectionActivities = activities(store, calls);
		const result = await runIngestionTaskWorkflowPlan({
			...testTaskStartMetadata,
			execute: async () => {
				calls.push("execute");
				return testResult();
			},
			projectionActivities,
			runNonCancellableCleanup: runImmediately,
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		expect(result.status).toBe("completed");
		expect(calls).toEqual(["start", "execute", "complete"]);
	});

	it("projects activity failure and preserves the failed Temporal outcome", async () => {
		const calls: string[] = [];
		const store = new InMemoryIngestionTaskStore();
		await expect(
			runIngestionTaskWorkflowPlan({
				...testTaskStartMetadata,
				execute: async () => {
					calls.push("execute");
					throw new Error("crawl failed");
				},
				projectionActivities: activities(store, calls),
				runNonCancellableCleanup: async (cleanup) => await cleanup(),
				snapshot: testSnapshot(),
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowRunId: "temporal-run-001",
			}),
		).rejects.toThrow("crawl failed");
		expect(store.getTask("task-curriculum-chunk-001")?.status).toBe("failed");
		expect(calls).toEqual(["start", "execute", "fail"]);
	});

	it("leaves retryable terminal projection failures to Temporal", async () => {
		const calls: string[] = [];
		const store = new InMemoryIngestionTaskStore();
		const projectionActivities = activities(store, calls);
		projectionActivities.completeIngestionTask = async () => {
			calls.push("complete");
			throw new Error("projection unavailable");
		};

		await expect(
			runIngestionTaskWorkflowPlan({
				...testTaskStartMetadata,
				execute: async () => {
					calls.push("execute");
					return testResult();
				},
				projectionActivities,
				runNonCancellableCleanup: runImmediately,
				snapshot: testSnapshot(),
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowRunId: "temporal-run-001",
			}),
		).rejects.toThrow("projection unavailable");
		expect(calls).toEqual(["start", "execute", "complete"]);
	});

	it("projects a non-retryable result contract failure as task failure", async () => {
		const calls: string[] = [];
		const store = new InMemoryIngestionTaskStore();
		const projectionActivities = activities(store, calls);
		projectionActivities.completeIngestionTask = async () => {
			calls.push("complete");
			throw ApplicationFailure.nonRetryable(
				"result identity mismatch",
				"invalid_ingestion_task_result",
			);
		};

		await expect(
			runIngestionTaskWorkflowPlan({
				...testTaskStartMetadata,
				execute: async () => {
					calls.push("execute");
					return testResult();
				},
				projectionActivities,
				runNonCancellableCleanup: runImmediately,
				snapshot: testSnapshot(),
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowRunId: "temporal-run-001",
			}),
		).rejects.toMatchObject({
			nonRetryable: true,
			type: "invalid_ingestion_task_result",
		});
		expect(store.getTask("task-curriculum-chunk-001")).toMatchObject({
			error_code: "invalid_ingestion_task_result",
			status: "failed",
		});
		expect(calls).toEqual(["start", "execute", "complete", "fail"]);
	});

	it("records cancellation and preserves the canceled Temporal outcome", async () => {
		const calls: string[] = [];
		const store = new InMemoryIngestionTaskStore();
		const cancellation = new Error("operator canceled workflow");

		await expect(
			runIngestionTaskWorkflowPlan({
				...testTaskStartMetadata,
				execute: async () => {
					calls.push("execute");
					throw cancellation;
				},
				isCancellationError: (error) => error === cancellation,
				projectionActivities: activities(store, calls),
				runNonCancellableCleanup: runImmediately,
				snapshot: testSnapshot(),
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowRunId: "temporal-run-001",
			}),
		).rejects.toBe(cancellation);
		expect(calls).toEqual(["start", "execute", "cancel"]);
		expect(store.getTask("task-curriculum-chunk-001")?.status).toBe("canceled");
	});
});

describe("internal portal notice publication workflow", () => {
	it("propagates correctness failures so Temporal pauses the schedule", async () => {
		const failure = temporalFailure(
			"ActivityFailure",
			ApplicationFailure.nonRetryable("checkpoint not found", "checkpoint_gap"),
		);
		await expect(
			runInternalPortalNoticePublicationPlan({
				execute: async () => {
					throw failure;
				},
				isCancellationError: () => false,
			}),
		).rejects.toBe(failure);
	});

	it("defers a temporary source failure without pausing the schedule", async () => {
		const result = await runInternalPortalNoticePublicationPlan({
			execute: async () => {
				throw temporalFailure(
					"ActivityFailure",
					ApplicationFailure.create({
						message: "source limited requests",
						nonRetryable: false,
						type: "internal_portal_source_deferred",
					}),
				);
			},
			isCancellationError: () => false,
		});

		expect(result).toEqual({
			errorCode: "internal_portal_source_deferred",
			outcome: "deferred",
			release: null,
			stream: null,
		});
	});

	it.each([
		"internal_portal_credential_expired",
		"internal_portal_credential_unavailable",
	] as const)("pauses and defers publication for %s", async (errorCode) => {
		const failure = temporalFailure(
			"ActivityFailure",
			ApplicationFailure.nonRetryable("credential rejected", errorCode),
		);

		const pauseForCredential = vi.fn(async () => undefined);
		await expect(
			runInternalPortalNoticePublicationPlan({
				execute: async () => {
					throw failure;
				},
				isCancellationError: () => false,
				pauseForCredential,
			}),
		).resolves.toMatchObject({ errorCode, outcome: "deferred" });
		expect(pauseForCredential).toHaveBeenCalledWith(errorCode);
	});

	it("never converts cancellation into a deferred result", async () => {
		const cancellation = new Error("workflow canceled");

		await expect(
			runInternalPortalNoticePublicationPlan({
				execute: async () => {
					throw cancellation;
				},
				isCancellationError: (error) => error === cancellation,
			}),
		).rejects.toBe(cancellation);
	});
});

async function runImmediately<T>(operation: () => Promise<T>): Promise<T> {
	return await operation();
}

function temporalFailure(type: string, cause: Error): Error & { type: string } {
	return Object.assign(new Error(type, { cause }), { type });
}

function activities(
	store: InMemoryIngestionTaskStore,
	calls: string[],
): IngestionProjectionActivities {
	return {
		async prepareSourceCollectorTask() {
			return null;
		},
		async recordIngestionTaskStarted(input) {
			calls.push("start");
			return store.recordTaskStarted(input);
		},
		async completeIngestionTask(input) {
			calls.push("complete");
			return store.completeTask({
				result: input.result,
				taskId: input.snapshot.task.task_id,
			});
		},
		async failIngestionTask(input) {
			calls.push("fail");
			return store.failTask(input);
		},
		async cancelIngestionTask(input) {
			calls.push("cancel");
			return store.cancelTask(input);
		},
	};
}
