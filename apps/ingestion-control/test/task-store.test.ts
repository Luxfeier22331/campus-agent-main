import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import { testResult, testSnapshot, testTaskStartMetadata } from "./fixtures";

describe("ingestion task projection store", () => {
	it("derives a running projection only from the frozen registry snapshot", () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-07-13T00:00:00.000Z"),
		});
		const record = store.recordTaskStarted({
			...testTaskStartMetadata,
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		expect(record).toMatchObject({
			status: "running",
			executor_kind: "rust_kernel",
			corpus: "curriculum",
			collection: "curriculum_plan",
			created_by: "test:operator",
		});
		expect(
			store.recordTaskStarted({
				...testTaskStartMetadata,
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
			result_contract: "retrieval_chunk_set.v2",
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
		});
		expect(failed).toMatchObject({
			status: "failed",
			result_ref: null,
			error_code: "collector_failed",
		});
	});

	it("rejects terminal error codes outside the persistence contract", () => {
		const store = startedStore();

		expect(() =>
			store.failTask({
				taskId: testSnapshot().task.task_id,
				errorCode: "authorization=Bearer secret-token",
			}),
		).toThrow("ingestion task error code is invalid");
		expect(store.getTask(testSnapshot().task.task_id)).toMatchObject({ status: "running" });
	});

	it("returns a stable second page when task timestamps are equal", () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-07-17T00:00:00.000Z"),
		});
		for (const taskId of ["task-001", "task-002", "task-003"]) {
			const snapshot = testSnapshot();
			snapshot.task.task_id = taskId;
			snapshot.task.run_id = `run-${taskId}`;
			store.recordTaskStarted({
				...testTaskStartMetadata,
				snapshot,
				workflowId: `ingestion/${taskId}`,
				workflowRunId: `temporal-${taskId}`,
			});
		}

		const first = store.listOperatorTaskProjections({ limit: 2 });
		const second = store.listOperatorTaskProjections({ cursor: first.page.next_cursor, limit: 2 });

		expect(first.tasks.map((task) => task.task_id)).toEqual(["task-003", "task-002"]);
		expect(first.page.next_cursor).not.toBeNull();
		expect(second.tasks.map((task) => task.task_id)).toEqual(["task-001"]);
		expect(second.page.next_cursor).toBeNull();
	});
});

function startedStore(): InMemoryIngestionTaskStore {
	const store = new InMemoryIngestionTaskStore();
	store.recordTaskStarted({
		...testTaskStartMetadata,
		snapshot: testSnapshot(),
		workflowId: "ingestion/task-curriculum-chunk-001",
		workflowRunId: "temporal-run-001",
	});
	return store;
}
