import { describe, expect, it } from "vitest";
import {
	type IngestionTaskRecord,
	matchesIngestionTaskProjectionFilters,
	normalizeIngestionTaskProjectionLimit,
	parseIngestionWorkflowStatus,
	toIngestionTaskOperatorProjection,
} from "../src/index.ts";

const digest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

const task: IngestionTaskRecord = {
	schema_version: "ingestion_task_envelope.v3",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
	input_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
		digest,
	},
	executor_kind: "rust_kernel",
	source_family: null,
	source_channel: null,
	corpus: "curriculum",
	collection: "curriculum_plan",
	input_contract: "canonical_document_units.v1",
	output_contract: "ingestion_chunk_set.v1",
	created_by: "ingestion-control/admin",
	created_at: "2026-06-11T00:00:00Z",
	status: "completed",
	updated_at: "2026-06-11T00:01:00Z",
	workflow_id: "campus-agent.ingestion.task_curriculum_chunk_001",
	workflow_run_id: "temporal-run-001",
	pipeline_workflow_id: null,
	retry_of_task_id: null,
	result_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-derived/ingestion/results/task_curriculum_chunk_001.json",
		digest,
	},
	result_contract: "ingestion_chunk_set.v1",
	summary: { chunk_count: 12 },
	error_code: null,
	error_message: null,
};

describe("ingestion task state projection", () => {
	it("builds a redacted generic operator projection", () => {
		const projection = toIngestionTaskOperatorProjection(task);
		expect(projection).toMatchObject({
			schema_version: "ingestion_task_operator_projection.v2",
			task_id: task.task_id,
			registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
			executor_kind: "rust_kernel",
			corpus: "curriculum",
			collection: "curriculum_plan",
			status: "completed",
			result_contract: "ingestion_chunk_set.v1",
			has_result: true,
			summary: { chunk_count: 12 },
		});
		expect(JSON.stringify(projection)).not.toContain("input_ref");
		expect(JSON.stringify(projection)).not.toContain("result_ref");
		expect(JSON.stringify(projection)).not.toContain("s3://");
	});

	it("matches generic filters and normalizes limits", () => {
		expect(
			matchesIngestionTaskProjectionFilters(task, {
				corpus: "curriculum",
				collection: "curriculum_plan",
				registryTaskId: task.registry_task_id,
				status: "completed",
			}),
		).toBe(true);
		expect(matchesIngestionTaskProjectionFilters(task, { status: "failed" })).toBe(false);
		expect(normalizeIngestionTaskProjectionLimit(null)).toBe(50);
		expect(normalizeIngestionTaskProjectionLimit(300)).toBe(200);
	});

	it("parses workflow status values fail-closed", () => {
		expect(parseIngestionWorkflowStatus(null)).toBeNull();
		expect(parseIngestionWorkflowStatus("running")).toBe("running");
		expect(() => parseIngestionWorkflowStatus("retrying")).toThrow(
			"unsupported ingestion task status: retrying",
		);
	});
});
