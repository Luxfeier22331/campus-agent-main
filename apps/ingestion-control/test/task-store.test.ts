import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import type { IngestionTaskEnvelope } from "../src/index.ts";

const baseTask: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	registry_task_id: "chunk_prepare",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

describe("InMemoryIngestionTaskStore", () => {
	it("admits a task once per idempotency key and keeps workflow identity stable", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });

		const admitted = store.admitTask(baseTask);
		const duplicate = store.admitTask(baseTask);

		expect(admitted.created).toBe(true);
		expect(admitted.record).toMatchObject({
			status: "accepted",
			task_id: baseTask.task_id,
			workflow_id: baseTask.task_id,
			workflow_run_id: null,
		});
		expect(duplicate.created).toBe(false);
		expect(duplicate.record.task_id).toBe(baseTask.task_id);
	});

	it("rejects idempotency key reuse for a different task id", () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(baseTask);

		expect(() =>
			store.admitTask({
				...baseTask,
				task_id: "task_other",
				idempotency_key: baseTask.idempotency_key,
			}),
		).toThrow(`ingestion task idempotency key already belongs to ${baseTask.task_id}`);
	});

	it("marks running, completes, and records terminal closeout", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });
		store.admitTask(baseTask);

		const running = store.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-001",
		});
		expect(running.status).toBe("running");
		expect(running.workflow_run_id).toBe("run-temporal-001");

		const completed = store.completeTask({
			taskId: baseTask.task_id,
			artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
		});

		expect(completed.status).toBe("completed");
		expect(completed.closeout?.terminal_status).toBe("completed");
		expect(completed.closeout?.artifact_refs).toHaveLength(1);
	});

	it("treats same-target Temporal activity retries as idempotent", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });
		store.admitTask(baseTask);

		const running = store.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-001",
		});
		expect(
			store.markTaskRunning({
				taskId: baseTask.task_id,
				workflowRunId: "run-temporal-001",
			}),
		).toEqual(running);

		const completed = store.completeTask({
			taskId: baseTask.task_id,
			artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
		});
		expect(
			store.completeTask({
				taskId: baseTask.task_id,
				artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
			}),
		).toEqual(completed);

		const failedStore = new InMemoryIngestionTaskStore();
		failedStore.admitTask(baseTask);
		failedStore.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-failed-001",
		});
		const failed = failedStore.failTask({
			taskId: baseTask.task_id,
			errorCode: "kernel_failed",
			errorMessage: "chunking failed",
		});
		expect(
			failedStore.failTask({
				taskId: baseTask.task_id,
				errorCode: "kernel_failed",
				errorMessage: "chunking failed",
			}),
		).toEqual(failed);
		expect(() =>
			failedStore.failTask({
				taskId: baseTask.task_id,
				errorCode: "different_failure",
				errorMessage: "different failure",
			}),
		).toThrow("terminal ingestion task cannot transition");
	});

	it("rejects running replays that target a different workflow run id", () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(baseTask);
		store.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-001",
		});

		expect(() =>
			store.markTaskRunning({
				taskId: baseTask.task_id,
				workflowRunId: "run-temporal-002",
			}),
		).toThrow("ingestion task workflow run id mismatch");
	});

	it("fails and cancels tasks without retry or lease bookkeeping", () => {
		const failedStore = new InMemoryIngestionTaskStore();
		failedStore.admitTask(baseTask);
		failedStore.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-failed-001",
		});

		const failed = failedStore.failTask({
			taskId: baseTask.task_id,
			errorCode: "kernel_failed",
			errorMessage: "chunking failed",
		});

		expect(failed.status).toBe("failed");
		expect(failed.closeout).toMatchObject({
			terminal_status: "failed",
			outcome_kind: "error",
			error: {
				code: "kernel_failed",
				message: "chunking failed",
			},
		});

		const canceledStore = new InMemoryIngestionTaskStore();
		canceledStore.admitTask(baseTask);
		canceledStore.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-canceled-001",
		});
		const canceled = canceledStore.cancelTask({
			taskId: baseTask.task_id,
			reason: "operator requested cancellation",
		});

		expect(canceled.status).toBe("canceled");
		expect(canceled.closeout).toMatchObject({
			terminal_status: "canceled",
			outcome_kind: "error",
			error: {
				code: "workflow_canceled",
				message: "operator requested cancellation",
			},
		});
	});

	it("rejects invalid workflow state transitions and terminal overwrites", () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(baseTask);

		expect(() =>
			store.completeTask({
				taskId: baseTask.task_id,
				artifactRefs: [],
			}),
		).toThrow("invalid ingestion task state transition");

		store.markTaskRunning({
			taskId: baseTask.task_id,
			workflowRunId: "run-temporal-001",
		});
		store.completeTask({ taskId: baseTask.task_id, artifactRefs: [] });

		expect(() =>
			store.failTask({
				taskId: baseTask.task_id,
				errorCode: "late_failure",
				errorMessage: "late failure",
			}),
		).toThrow("terminal ingestion task cannot transition");
	});

	it("allows accepted tasks to fail only when workflow start fails", () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(baseTask);

		expect(() =>
			store.failTask({
				taskId: baseTask.task_id,
				errorCode: "runtime_failed",
				errorMessage: "runtime failed",
			}),
		).toThrow("invalid ingestion task state transition");

		const failed = store.failTask({
			taskId: baseTask.task_id,
			errorCode: "workflow_start_failed",
			errorMessage: "temporal unavailable",
		});

		expect(failed.status).toBe("failed");
		expect(failed.closeout?.error?.code).toBe("workflow_start_failed");
	});

	it("requires workflow run id for new running transitions", () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(baseTask);

		expect(() => store.markTaskRunning({ taskId: baseTask.task_id })).toThrow(
			"workflow run id is required",
		);
	});
});
