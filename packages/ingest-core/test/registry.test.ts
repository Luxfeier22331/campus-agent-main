import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import { createIngestionTaskRegistryCatalog, RegistryAdmissionError } from "../src/index.ts";

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v3",
	tasks: [
		{
			registry_task_id: "official_web.capture",
			executor_kind: "source_collector",
			input_contract: "official_web_capture_request.v1",
			output_contract: "official_web_source_manifest.v1",
			source: { family: "official_web", channel: "official_web" },
		},
	],
};

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v3",
	task_id: "task_001",
	run_id: "run_001",
	registry_task_id: "official_web.capture",
	input_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-source/requests/official-web.json",
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
};

describe("ingestion task registry catalog", () => {
	it("resolves globally unique task declarations", () => {
		const catalog = createIngestionTaskRegistryCatalog([registry]);
		expect(catalog.requireRegistry(task)).toBe(registry);
		expect(catalog.requireTask(task)).toBe(registry.tasks[0]);
		expect(catalog.requireTaskById("official_web.capture")).toBe(registry.tasks[0]);
	});

	it("fails closed for duplicate and undeclared task ids", () => {
		expect(() => createIngestionTaskRegistryCatalog([registry, registry])).toThrow(
			"duplicate ingestion task declaration: official_web.capture",
		);
		const catalog = createIngestionTaskRegistryCatalog([]);
		expect(() => catalog.requireTask(task)).toThrow(RegistryAdmissionError);
	});
});
