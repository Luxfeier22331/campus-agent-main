import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import { createIngestionTaskRegistryCatalog, RegistryAdmissionError } from "../src/index.ts";

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v3",
	tasks: [
		{
			executor_kind: "rust_kernel",
			input_contract: "canonical_document_units.v2",
			kernel_id: "build-retrieval-chunks-v2",
			output_contract: "retrieval_chunk_set.v2",
			registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
			target: { collection: "curriculum_plan", corpus: "curriculum" },
		},
	],
};

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v3",
	task_id: "task_001",
	run_id: "run_001",
	registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
	input_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum-plan/document-units.jsonl",
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
};

describe("ingestion task registry catalog", () => {
	it("resolves globally unique task declarations", () => {
		const catalog = createIngestionTaskRegistryCatalog([registry]);
		expect(catalog.requireRegistry(task)).toBe(registry);
		expect(catalog.requireTask(task)).toBe(registry.tasks[0]);
		expect(catalog.requireTaskById("curriculum.curriculum_plan.chunk_prepare")).toBe(
			registry.tasks[0],
		);
	});

	it("fails closed for duplicate and undeclared task ids", () => {
		expect(() => createIngestionTaskRegistryCatalog([registry, registry])).toThrow(
			"duplicate ingestion task declaration: curriculum.curriculum_plan.chunk_prepare",
		);
		const catalog = createIngestionTaskRegistryCatalog([]);
		expect(() => catalog.requireTask(task)).toThrow(RegistryAdmissionError);
	});
});
