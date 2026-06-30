import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type IngestionArtifactRef,
	type IngestionTaskEnvelope,
	validateIngestionTaskEnvelope,
	validateIngestionTaskRegistry,
} from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(fixtureRoot, name), "utf8"));
}

describe("ingestion task contracts", () => {
	it("exports the shared task envelope DTO used by runtime clients", () => {
		const inputRef: IngestionArtifactRef = {
			kind: "object_store",
			uri: "s3://campus-rag-source/official_web/run/source-truth-bundle.json",
		};
		const envelope: IngestionTaskEnvelope = {
			schema_version: "ingestion_task_envelope.v1",
			task_id: "task_01",
			run_id: "run_01",
			source_family: "official_web",
			source_channel: "official_web",
			corpus: "official_web",
			collection: "stable_reference",
			task_kind: "source_truth_materialize",
			input_ref: inputRef,
			output_contract: "official_web_stable_reference_source_truth.v1",
			idempotency_key: "official_web/stable_reference/source_truth_materialize/run_01",
			lease_policy: {
				lease_seconds: 300,
				heartbeat_seconds: 30,
			},
			retry_policy: {
				max_attempts: 3,
			},
			created_by: "test",
			created_at: "2026-03-29T08:17:33.000Z",
		};

		expect(validateIngestionTaskEnvelope(envelope).ok).toBe(true);
	});

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
