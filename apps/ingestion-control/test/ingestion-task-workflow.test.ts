import { ApplicationFailure } from "@temporalio/workflow";
import { describe, expect, it } from "vitest";
import type { IngestionProjectionActivities } from "../src/activities";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import { runIngestionTaskWorkflowPlan } from "../src/workflows/ingestion-task-workflow";
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

async function runImmediately<T>(operation: () => Promise<T>): Promise<T> {
	return await operation();
}

function activities(
	store: InMemoryIngestionTaskStore,
	calls: string[],
): IngestionProjectionActivities {
	return {
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
