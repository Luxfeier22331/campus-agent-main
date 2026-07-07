import { describe, expect, it } from "vitest";
import { IngestionTaskEnvelopeParseError, parseIngestionTaskEnvelope } from "../src/index.ts";

const task = {
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

describe("ingestion task envelope parser", () => {
	it("returns the typed envelope for valid admission payloads", () => {
		expect(parseIngestionTaskEnvelope(task)).toEqual(task);
	});

	it("fails closed with contract validation errors", () => {
		expect(() => parseIngestionTaskEnvelope({ ...task, task_id: "" })).toThrow(
			new IngestionTaskEnvelopeParseError("invalid ingestion task: task_id must be non-empty"),
		);
		expect(() => parseIngestionTaskEnvelope({ ...task, extra_field: "not allowed" })).toThrow(
			"invalid ingestion task: extra_field is not allowed",
		);
	});
});
