import { describe, expect, it } from "vitest";
import { parseIngestionTaskEnvelope } from "../src/index.ts";

const task = {
	schema_version: "ingestion_task_envelope.v3",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
	input_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
};

describe("ingestion task envelope parser", () => {
	it("returns the typed envelope for valid admission payloads", () => {
		expect(parseIngestionTaskEnvelope(task)).toEqual(task);
	});

	it("fails closed with contract validation errors", () => {
		expect(() => parseIngestionTaskEnvelope({ ...task, task_id: "" })).toThrow(
			/invalid ingestion task: task_id/u,
		);
		expect(() => parseIngestionTaskEnvelope({ ...task, extra_field: "not allowed" })).toThrow(
			"invalid ingestion task: extra_field is not allowed",
		);
	});
});
