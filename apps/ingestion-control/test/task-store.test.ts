import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import { testResult, testSnapshot } from "./fixtures";

describe("ingestion task projection store", () => {
	it("derives a running projection only from the frozen registry snapshot", () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-07-13T00:00:00.000Z"),
		});
		const record = store.recordTaskStarted({
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		expect(record).toMatchObject({
			status: "running",
			executor_kind: "rust_kernel",
			corpus: "curriculum",
			collection: "curriculum_plan",
			created_by: "temporal",
		});
		expect(
			store.recordTaskStarted({
				snapshot: testSnapshot(),
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowRunId: "temporal-run-001",
			}),
		).toEqual(record);
	});

	it("stores one bounded result and hides its object URI from the operator list", () => {
		const store = startedStore();
		const completed = store.completeTask({
			taskId: testSnapshot().task.task_id,
			result: testResult(),
		});
		expect(completed).toMatchObject({
			status: "completed",
			result_contract: "ingestion_chunk_set.v1",
		});
		const projection = store.listOperatorTaskProjections({ corpus: "curriculum" }).tasks[0];
		expect(projection).toMatchObject({ has_result: true, summary: { chunk_count: 12 } });
		expect(JSON.stringify(projection)).not.toContain("s3://");
		expect(
			store.completeTask({ taskId: testSnapshot().task.task_id, result: testResult() }),
		).toEqual(completed);
	});

	it("records bounded terminal errors without result fields", () => {
		const store = startedStore();
		const failed = store.failTask({
			taskId: testSnapshot().task.task_id,
			errorCode: "collector_failed",
			errorMessage: "provider unavailable",
		});
		expect(failed).toMatchObject({
			status: "failed",
			result_ref: null,
			error_code: "collector_failed",
		});
	});
});

function startedStore(): InMemoryIngestionTaskStore {
	const store = new InMemoryIngestionTaskStore();
	store.recordTaskStarted({
		snapshot: testSnapshot(),
		workflowId: "ingestion/task-curriculum-chunk-001",
		workflowRunId: "temporal-run-001",
	});
	return store;
}
