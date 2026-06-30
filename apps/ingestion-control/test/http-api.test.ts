import { describe, expect, it } from "vitest";
import {
	createIngestionControlHandler,
	createIngestionTaskRegistryCatalog,
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
	it("admits and exposes queue state without executor mutation routes", async () => {
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v1",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
							can_publish_alias: false,
						},
					],
				},
			]),
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

		const fetchedResponse = await handler(
			new Request(`http://ingestion-control/internal/ingestion/tasks/${task.task_id}`),
		);
		expect(fetchedResponse.status).toBeLessThan(400);
		const fetched = await json(fetchedResponse);
		expect(fetched.task_id).toBe(task.task_id);
		expect(fetched.status).toBe("queued");
	});

	it("does not expose executor claim, heartbeat, complete or fail mutation routes", async () => {
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			store: new InMemoryIngestionTaskStore(),
		});

		const routes = [
			new Request("http://ingestion-control/internal/ingestion/tasks/next"),
			new Request("http://ingestion-control/internal/ingestion/tasks/claim", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/heartbeat", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/complete", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a", artifact_refs: [] }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/fail", {
				method: "POST",
				body: JSON.stringify({
					error_code: "failed",
					error_message: "failed",
					worker_id: "worker-a",
				}),
			}),
		];

		for (const request of routes) {
			const response = await handler(request);
			expect(response.status).toBe(404);
		}
	});

	it("rejects task admission before storage when registry membership is missing", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			store,
		});

		const response = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(400);
		expect(await json(response)).toEqual({
			error:
				"task collection is not declared by ingestion registry: curriculum/curriculum/curriculum_plan",
		});
		expect(store.nextTask()).toBeNull();
	});

	it("rejects task admission before storage when output contract mismatches the registry", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v1",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "expected_chunk_set.v1",
							can_publish_alias: false,
						},
					],
				},
			]),
			store,
		});

		const response = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(400);
		expect(await json(response)).toEqual({
			error:
				"output contract mismatch for chunk_prepare: expected expected_chunk_set.v1, got ingestion_chunk_set.v1",
		});
		expect(store.nextTask()).toBeNull();
	});
});

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}
