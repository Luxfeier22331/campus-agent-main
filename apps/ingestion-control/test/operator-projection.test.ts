import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import {
	createIngestionControlHandler,
	createIngestionTaskRegistryCatalog,
	type IngestionTaskEnvelope,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
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

const serviceTokens = {
	adminToken: "admin-token",
	appApiProjectionToken: "app-api-projection-token",
	officialWebCollectorToken: "collector-token",
	officialWebExecutionStatusToken: "execution-status-token",
	officialWebProjectionToken: "projection-token",
};

describe("ingestion-control operator projection", () => {
	it("returns redacted task snapshots without input or artifact refs", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
			workflowStarter: {
				async startTask(admitted) {
					return { workflowId: admitted.workflow_id, workflowRunId: "temporal-run-001" };
				},
			},
		});

		const admitResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(admitResponse.status).toBeLessThan(400);

		const running = store.markTaskRunning({
			taskId: task.task_id,
			workflowRunId: "temporal-run-001",
		});
		expect(running.task_id).toBe(task.task_id);
		store.completeTask({
			taskId: task.task_id,
			artifactRefs: [
				{
					kind: "object_store",
					uri: "s3://campus-agent-derived/curriculum/curriculum_plan/chunks.jsonl",
				},
			],
		});

		const projectionResponse = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/operator-projection/tasks?corpus=curriculum&collection=curriculum_plan",
				"app-api",
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
					registry_task_id: "chunk_prepare",
					task_kind: "chunk_prepare",
					status: "completed",
					created_at: "2026-06-11T00:00:00Z",
					updated_at: "2026-06-11T00:00:00.000Z",
					terminal_status: "completed",
					outcome_kind: "success",
					artifact_count: 1,
					last_error_code: null,
					last_error_message: null,
					workflow_id: task.task_id,
					workflow_run_id: "temporal-run-001",
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

function authorizedRequest(url: string, principal: "admin" | "app-api", init: RequestInit = {}) {
	return new Request(url, {
		...init,
		headers: {
			...(init.headers as Record<string, string> | undefined),
			authorization: `Bearer ${
				principal === "admin" ? serviceTokens.adminToken : serviceTokens.appApiProjectionToken
			}`,
		},
	});
}
