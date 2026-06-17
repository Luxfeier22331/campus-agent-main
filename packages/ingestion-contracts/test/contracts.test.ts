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

	it("prevents rust kernels from owning alias publish tasks", () => {
		expect(validateIngestionTaskRegistry(loadFixture("task-registry.valid.json")).ok).toBe(true);

		const result = validateIngestionTaskRegistry(
			loadFixture("task-registry.invalid-alias-kernel.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("tasks[0] alias_publish cannot be executed by rust_kernel");
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
