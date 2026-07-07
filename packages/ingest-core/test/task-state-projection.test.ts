import { describe, expect, it } from "vitest";
import {
	type IngestionTaskRecord,
	matchesIngestionTaskProjectionFilters,
	normalizeIngestionTaskProjectionLimit,
	parseIngestionWorkflowStatus,
	toIngestionTaskOperatorProjection,
} from "../src/index.ts";

const task: IngestionTaskRecord = {
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
	status: "completed",
	updated_at: "2026-06-11T00:00:00.000Z",
	closeout: {
		task_id: "task_curriculum_chunk_001",
		terminal_status: "completed",
		outcome_kind: "success",
		artifact_refs: [
			{
				kind: "object_store",
				uri: "s3://campus-agent-derived/curriculum/curriculum_plan/chunks.jsonl",
			},
		],
	},
	workflow_id: "task_curriculum_chunk_001",
	workflow_run_id: "temporal-run-001",
};

describe("ingestion task state projection", () => {
	it("builds redacted operator projections without input or artifact refs", () => {
		const projection = toIngestionTaskOperatorProjection(task);

		expect(projection).toEqual({
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
		});
		expect(JSON.stringify(projection)).not.toContain("input_ref");
		expect(JSON.stringify(projection)).not.toContain("artifact_refs");
		expect(JSON.stringify(projection)).not.toContain("s3://campus-agent-derived");
	});

	it("matches projection filters and normalizes limits", () => {
		expect(
			matchesIngestionTaskProjectionFilters(task, {
				corpus: "curriculum",
				collection: "curriculum_plan",
				runId: "run_curriculum_20260611",
				status: "completed",
			}),
		).toBe(true);
		expect(matchesIngestionTaskProjectionFilters(task, { status: "failed" })).toBe(false);
		expect(normalizeIngestionTaskProjectionLimit(null)).toBe(50);
		expect(normalizeIngestionTaskProjectionLimit(-1)).toBe(50);
		expect(normalizeIngestionTaskProjectionLimit(300)).toBe(200);
		expect(normalizeIngestionTaskProjectionLimit(25)).toBe(25);
	});

	it("parses workflow status values fail-closed", () => {
		expect(parseIngestionWorkflowStatus(null)).toBeNull();
		expect(parseIngestionWorkflowStatus("running")).toBe("running");
		expect(() => parseIngestionWorkflowStatus("retrying")).toThrow(
			"unsupported ingestion task status: retrying",
		);
	});
});
