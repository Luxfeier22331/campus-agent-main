import { describe, expect, it } from "vitest";
import {
	createIngestionControlHandler,
	type IngestionTaskEnvelope,
	InMemoryIngestionTaskStore,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
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

describe("ingestion-control internal HTTP API", () => {
	it("admits, claims, completes, and exposes queue state", async () => {
		const handler = createIngestionControlHandler({
			store: new InMemoryIngestionTaskStore({
				now: () => new Date("2026-06-11T00:00:00Z"),
			}),
		});

		const admittedResponse = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(admittedResponse.status).toBeLessThan(400);
		const admitted = await json(admittedResponse);
		expect(admitted.status).toBe("queued");

		const nextResponse = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks/next"),
		);
		expect(nextResponse.status).toBeLessThan(400);
		const next = await json(nextResponse);
		expect(next.task_id).toBe(task.task_id);

		const claimedResponse = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks/claim", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
		);
		expect(claimedResponse.status).toBeLessThan(400);
		const claimed = await json(claimedResponse);
		expect(claimed.status).toBe("running");
		expect(claimed.leased_by).toBe("worker-a");

		const heartbeatResponse = await handler(
			new Request(`http://ingestion-control/internal/ingestion/tasks/${task.task_id}/heartbeat`, {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
		);
		expect(heartbeatResponse.status).toBeLessThan(400);
		const heartbeat = await json(heartbeatResponse);
		expect(heartbeat.status).toBe("running");
		expect(heartbeat.leased_by).toBe("worker-a");

		const fetchedResponse = await handler(
			new Request(`http://ingestion-control/internal/ingestion/tasks/${task.task_id}`),
		);
		expect(fetchedResponse.status).toBeLessThan(400);
		const fetched = await json(fetchedResponse);
		expect(fetched.task_id).toBe(task.task_id);

		const completedResponse = await handler(
			new Request(`http://ingestion-control/internal/ingestion/tasks/${task.task_id}/complete`, {
				method: "POST",
				body: JSON.stringify({
					worker_id: "worker-a",
					artifact_refs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
				}),
			}),
		);
		expect(completedResponse.status).toBeLessThan(400);
		const completed = await json(completedResponse);
		expect(completed.status).toBe("completed");
		expect(typeof completed.closeout).toBe("object");
		expect(completed.closeout).not.toBeNull();
		expect((completed.closeout as Record<string, unknown>).terminal_status).toBe("completed");
	});
});

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}
