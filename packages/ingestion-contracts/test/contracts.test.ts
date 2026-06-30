import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateIngestionTaskEnvelope, validateIngestionTaskRegistry } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(fixtureRoot, name), "utf8"));
}

describe("ingestion task contracts", () => {
	it("accepts a valid task envelope and rejects missing idempotency", () => {
		expect(validateIngestionTaskEnvelope(loadFixture("task-envelope.valid.json")).ok).toBe(true);

		const result = validateIngestionTaskEnvelope(
			loadFixture("task-envelope.invalid-missing-idempotency.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("idempotency_key is required");
		}
	});

	it("accepts active registry task kinds only", () => {
		expect(validateIngestionTaskRegistry(loadFixture("task-registry.valid.json")).ok).toBe(true);

		const result = validateIngestionTaskRegistry({
			schema_version: "ingestion_task_registry.v1",
			source_family: "curriculum",
			corpus: "curriculum",
			collection: "curriculum_plan",
			tasks: [
				{
					task_kind: "alias_publish",
					executor_kind: "ts_control",
					input_contract: "ingestion_release_manifest.v1",
					output_contract: "ingestion_alias_publish_closeout.v1",
					can_publish_alias: true,
				},
			],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("tasks[0].task_kind is not supported: alias_publish");
		}
	});

	it("rejects python adapters in repo-owned task registries", () => {
		const result = validateIngestionTaskRegistry(
			loadFixture("task-registry.invalid-python-adapter.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("tasks[0].executor_kind is not supported: python_adapter");
		}
	});
});
