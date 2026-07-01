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
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
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

describe("ingestion-control operator projection", () => {
	it("returns redacted task snapshots without input or artifact refs", async () => {
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
							output_contract: "ingestion_chunk_set.v1",
							can_publish_alias: false,
						},
					],
				},
			]),
			store,
		});

		const admitResponse = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(admitResponse.status).toBeLessThan(400);

		const claimed = store.claimNextTask({ workerId: "worker-a" });
		expect(claimed?.task_id).toBe(task.task_id);
		store.completeTask({
			taskId: task.task_id,
			workerId: "worker-a",
			artifactRefs: [
				{
					kind: "object_store",
					uri: "s3://campus-agent-derived/curriculum/curriculum_plan/chunks.jsonl",
				},
			],
		});

		const projectionResponse = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operator-projection/tasks?corpus=curriculum&collection=curriculum_plan",
			),
		);
		expect(projectionResponse.status).toBeLessThan(400);
		const projection = await json(projectionResponse);

		expect(projection).toEqual({
			page: { next_cursor: null },
			tasks: [
				{
					schema_version: "ingestion_task_operator_projection.v1",
					task_id: task.task_id,
					run_id: task.run_id,
					source_family: "curriculum",
					source_channel: "curriculum_plan",
					corpus: "curriculum",
					collection: "curriculum_plan",
					task_kind: "chunk_prepare",
					status: "completed",
					attempt_count: 1,
					created_at: "2026-06-11T00:00:00Z",
					updated_at: "2026-06-11T00:00:00.000Z",
					lease_expires_at: null,
					terminal_status: "completed",
					outcome_kind: "success",
					artifact_count: 1,
					last_error_code: null,
					last_error_message: null,
				},
			],
		});
		expect(JSON.stringify(projection)).not.toContain("input_ref");
		expect(JSON.stringify(projection)).not.toContain("artifact_refs");
		expect(JSON.stringify(projection)).not.toContain("s3://campus-agent-derived");
	});
});

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}
