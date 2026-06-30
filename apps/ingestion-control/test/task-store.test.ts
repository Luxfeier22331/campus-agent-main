import { describe, expect, it } from "vitest";
import { type IngestionTaskEnvelope, InMemoryIngestionTaskStore } from "../src/index.ts";

const baseTask: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-rag-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 3,
	},
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

describe("InMemoryIngestionTaskStore", () => {
	it("admits a task once per idempotency key and exposes it for claim", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });

		const admitted = store.admitTask(baseTask);
		const duplicate = store.admitTask({ ...baseTask, task_id: "task_duplicate_id" });

		expect(admitted.status).toBe("queued");
		expect(duplicate.task_id).toBe(baseTask.task_id);
		expect(store.nextTask()?.task_id).toBe(baseTask.task_id);
	});

	it("claims, completes, and records terminal closeout", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });
		store.admitTask(baseTask);

		const claimed = store.claimNextTask({ workerId: "worker-a" });
		expect(claimed?.status).toBe("running");
		expect(claimed?.leased_by).toBe("worker-a");

		const completed = store.completeTask({
			taskId: baseTask.task_id,
			workerId: "worker-a",
			artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
		});

		expect(completed.status).toBe("completed");
		expect(completed.closeout?.terminal_status).toBe("completed");
		expect(completed.closeout?.artifact_refs).toHaveLength(1);
		expect(store.nextTask()).toBeNull();
	});

	it("dead-letters a task when retry attempts are exhausted", () => {
		const store = new InMemoryIngestionTaskStore({ now: () => new Date("2026-06-11T00:00:00Z") });
		store.admitTask({ ...baseTask, retry_policy: { max_attempts: 1 } });

		const claimed = store.claimNextTask({ workerId: "worker-a" });
		expect(claimed?.attempt_count).toBe(1);

		const failed = store.failTask({
			taskId: baseTask.task_id,
			workerId: "worker-a",
			errorCode: "kernel_failed",
			errorMessage: "chunking failed",
		});

		expect(failed.status).toBe("dead_lettered");
		expect(failed.closeout?.terminal_status).toBe("dead_lettered");
		expect(store.nextTask()).toBeNull();
	});

	it("rejects heartbeat and terminal closeout after the lease expires", () => {
		let now = new Date("2026-06-11T00:00:00Z");
		const store = new InMemoryIngestionTaskStore({ now: () => now });
		store.admitTask({
			...baseTask,
			lease_policy: {
				heartbeat_seconds: 1,
				lease_seconds: 1,
			},
		});
		store.claimNextTask({ workerId: "worker-a" });
		now = new Date("2026-06-11T00:00:02Z");

		expect(() => store.heartbeatTask({ taskId: baseTask.task_id, workerId: "worker-a" })).toThrow(
			"ingestion task lease expired",
		);
		expect(() =>
			store.completeTask({
				taskId: baseTask.task_id,
				workerId: "worker-a",
			}),
		).toThrow("ingestion task lease expired");
		expect(() =>
			store.failTask({
				taskId: baseTask.task_id,
				workerId: "worker-a",
				errorCode: "failed",
				errorMessage: "failed",
			}),
		).toThrow("ingestion task lease expired");
	});

	it("sweeps expired running tasks back to queued until retry attempts are exhausted", () => {
		let now = new Date("2026-06-11T00:00:00Z");
		const store = new InMemoryIngestionTaskStore({ now: () => now });
		store.admitTask({
			...baseTask,
			lease_policy: {
				heartbeat_seconds: 1,
				lease_seconds: 1,
			},
			retry_policy: {
				max_attempts: 2,
			},
		});
		store.claimNextTask({ workerId: "worker-a" });
		now = new Date("2026-06-11T00:00:02Z");

		const firstSweep = store.sweepExpiredLeases();
		expect(firstSweep).toEqual({ deadLettered: 0, requeued: 1 });
		expect(store.getTask(baseTask.task_id)?.status).toBe("queued");

		store.claimNextTask({ workerId: "worker-b" });
		now = new Date("2026-06-11T00:00:04Z");

		const secondSweep = store.sweepExpiredLeases();
		expect(secondSweep).toEqual({ deadLettered: 1, requeued: 0 });
		const deadLettered = store.getTask(baseTask.task_id);
		expect(deadLettered?.status).toBe("dead_lettered");
		expect(deadLettered?.closeout?.error?.code).toBe("lease_expired");
	});
});
