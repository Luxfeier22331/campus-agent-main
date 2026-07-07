import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import { createIngestionTaskRegistryCatalog, RegistryAdmissionError } from "../src/index.ts";

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	tasks: [
		{
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
		},
	],
};

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_001",
	run_id: "run_001",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-source/official_web/source-truth-bundle.json",
	},
	input_contract: "official_web_source_truth_bundle.v1",
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/run_001",
	created_by: "test",
	created_at: "2026-07-04T00:00:00.000Z",
};

describe("ingestion task registry catalog", () => {
	it("requires declared registry tasks and output contracts", () => {
		const catalog = createIngestionTaskRegistryCatalog([registry]);

		expect(catalog.requireRegistry(task)).toBe(registry);
		expect(catalog.requireTask(task)).toBe(registry.tasks[0]);
		expect(() =>
			catalog.requireTask({
				...task,
				output_contract: "wrong_output.v1",
			}),
		).toThrow(RegistryAdmissionError);
	});

	it("fails closed for duplicate registries and undeclared collections", () => {
		expect(() => createIngestionTaskRegistryCatalog([registry, registry])).toThrow(
			"duplicate ingestion task registry: official_web/official_web/stable_reference",
		);
		expect(() =>
			createIngestionTaskRegistryCatalog([
				{
					...registry,
					tasks: [registry.tasks[0], registry.tasks[0]],
				},
			]),
		).toThrow(
			"duplicate ingestion task declaration: official_web/official_web/stable_reference/source_truth_materialize",
		);
		const catalog = createIngestionTaskRegistryCatalog([]);
		expect(() => catalog.requireTask(task)).toThrow(
			"task collection is not declared by ingestion registry: official_web/official_web/stable_reference",
		);
	});
});
