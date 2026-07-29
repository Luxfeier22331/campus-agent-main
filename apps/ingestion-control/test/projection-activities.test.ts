import { ApplicationFailure } from "@temporalio/activity";
import { sha256Hex } from "ingest-core";
import { describe, expect, it } from "vitest";
import { createIngestionProjectionActivities } from "../src/activities";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import { testResult, testSnapshot, testTaskStartMetadata } from "./fixtures";

describe("ingestion projection activities", () => {
	it("rejects a result that does not match the frozen snapshot before projection", async () => {
		const store = new InMemoryIngestionTaskStore();
		const snapshot = testSnapshot();
		store.recordTaskStarted({
			...testTaskStartMetadata,
			snapshot,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		const activities = createIngestionProjectionActivities({
			objectStore: {
				derivedBucket: "campus-agent-derived",
				sourceBucket: "campus-agent-source",
				async getObject() {
					throw new Error("result artifact must not be read before identity validation");
				},
				async createOrVerifyObject() {
					throw new Error("not used");
				},
				async headObject() {
					throw new Error("result artifact must not be read before identity validation");
				},
			},
			store,
		});

		const completion = activities.completeIngestionTask({
			result: {
				...testResult(),
				run_id: "another-run",
			},
			snapshot,
		});

		await expect(completion).rejects.toMatchObject({
			nonRetryable: true,
			type: "invalid_ingestion_task_result",
		});
		await expect(completion).rejects.toBeInstanceOf(ApplicationFailure);
		expect(store.getTask(snapshot.task.task_id)?.status).toBe("running");
	});

	it("verifies the digest and Rust output contract before completing", async () => {
		const store = new InMemoryIngestionTaskStore();
		const snapshot = testSnapshot({
			kernel_id: "build-retrieval-chunks-v2",
			output_contract: "retrieval_chunk_set.v2",
		});
		store.recordTaskStarted({
			...testTaskStartMetadata,
			snapshot,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		const bytes = new TextEncoder().encode(
			JSON.stringify({
				chunk_count: 0,
				chunks: [],
				error_count: 0,
				errors: [],
				schema_version: "retrieval_chunk_set.v2",
			}),
		);
		const result = {
			...testResult(),
			result_ref: {
				byte_size: bytes.byteLength,
				kind: "object_store" as const,
				uri: "s3://campus-agent-derived/ingestion-kernels/curriculum.curriculum_plan.chunk_prepare/runs/run-curriculum-001/attempts/1/task-curriculum-chunk-001/build-retrieval-chunks-v2.json",
				digest: `sha256:${sha256Hex(bytes)}`,
			},
		};
		const activities = createIngestionProjectionActivities({
			objectStore: {
				derivedBucket: "campus-agent-derived",
				sourceBucket: "campus-agent-source",
				async getObject() {
					return bytes;
				},
				async createOrVerifyObject() {
					throw new Error("not used");
				},
				async headObject() {
					return { byteSize: bytes.byteLength, contentSha256: sha256Hex(bytes) };
				},
			},
			store,
		});

		await expect(activities.completeIngestionTask({ result, snapshot })).resolves.toMatchObject({
			status: "completed",
		});
	});

	it("classifies a missing result object as a permanent contract failure", async () => {
		const store = new InMemoryIngestionTaskStore();
		const snapshot = testSnapshot();
		store.recordTaskStarted({
			...testTaskStartMetadata,
			snapshot,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		const activities = createIngestionProjectionActivities({
			objectStore: {
				derivedBucket: "campus-agent-derived",
				sourceBucket: "campus-agent-source",
				async getObject() {
					throw Object.assign(new Error("missing result object"), {
						name: "NoSuchKey",
						$metadata: { httpStatusCode: 404 },
					});
				},
				async createOrVerifyObject() {
					throw new Error("not used");
				},
				async headObject() {
					throw Object.assign(new Error("missing result object"), {
						name: "NoSuchKey",
						$metadata: { httpStatusCode: 404 },
					});
				},
			},
			store,
		});

		await expect(
			activities.completeIngestionTask({ result: testResult(), snapshot }),
		).rejects.toMatchObject({
			nonRetryable: true,
			type: "invalid_ingestion_task_result",
		});
		expect(store.getTask(snapshot.task.task_id)?.status).toBe("running");
	});
});
