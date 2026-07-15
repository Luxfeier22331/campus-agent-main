import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type IngestionTaskEnvelope,
	type IngestionTaskResult,
	validateCanonicalDocumentUnit,
	validateCanonicalDocumentUnitsJsonl,
	validateIngestionReleaseManifest,
	validateIngestionTaskEnvelope,
	validateIngestionTaskRegistry,
	validateIngestionTaskResult,
} from "../src/index.ts";

const assertionRoot = join(import.meta.dirname, "..", "assertions");
const digest = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function loadAssertion(name: string): unknown {
	return JSON.parse(readFileSync(join(assertionRoot, name), "utf8"));
}

describe("ingestion task contracts", () => {
	it("validates canonical document units with reader-facing identity fields", () => {
		const validUnit = {
			anchor: { source_uri: "s3://campus-agent-source/example/document.md" },
			chunk_id: "unit-001",
			clean_text: "第一段内容",
			doc_id: "doc-001",
			metadata: { heading: "总则" },
			root_unit_id: "root-001",
			text: "第一段内容",
			unit_type: "paragraph",
			version_id: "version-001",
		};

		expect(validateCanonicalDocumentUnit(validUnit).ok).toBe(true);
		expect(
			validateCanonicalDocumentUnitsJsonl(
				`${JSON.stringify(validUnit)}\n${JSON.stringify(validUnit)}\n`,
			).ok,
		).toBe(true);
		expect(validateCanonicalDocumentUnit({ metadata: {}, text: "legacy" }).ok).toBe(false);
	});

	it("keeps the task envelope small and derives execution metadata from the registry", () => {
		const envelope: IngestionTaskEnvelope = {
			schema_version: "ingestion_task_envelope.v3",
			task_id: "task_01",
			run_id: "run_01",
			registry_task_id: "official_web.capture",
			input_ref: {
				byte_size: 128,
				kind: "object_store",
				uri: "s3://campus-agent-source/requests/official-web.json",
				digest,
			},
		};

		expect(validateIngestionTaskEnvelope(envelope).ok).toBe(true);
		expect(validateIngestionTaskEnvelope({ ...envelope, corpus: "official_web" }).ok).toBe(false);
		expect(validateIngestionTaskEnvelope({ ...envelope, task_id: "x".repeat(201) }).ok).toBe(false);
		expect(validateIngestionTaskEnvelope({ ...envelope, run_id: "run/unsafe" }).ok).toBe(false);
	});

	it("requires an immutable input digest", () => {
		expect(validateIngestionTaskEnvelope(loadAssertion("task-envelope.valid.json")).ok).toBe(true);
		const result = validateIngestionTaskEnvelope(
			loadAssertion("task-envelope.invalid-missing-digest.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("input_ref.digest is required");
		}
	});

	it("validates source collector and Rust registry declarations only", () => {
		expect(validateIngestionTaskRegistry(loadAssertion("task-registry.valid.json")).ok).toBe(true);
		expect(
			validateIngestionTaskRegistry(loadAssertion("task-registry.invalid-python-adapter.json")).ok,
		).toBe(false);
		expect(
			validateIngestionTaskRegistry({
				schema_version: "ingestion_task_registry.v3",
				tasks: [
					{
						registry_task_id: "official_web.capture",
						executor_kind: "source_collector",
						input_contract: "official_web_capture_request.v1",
						output_contract: "official_web_source_manifest.v1",
					},
				],
			}).ok,
		).toBe(false);
	});

	it("validates a single bounded result reference", () => {
		const result: IngestionTaskResult = {
			schema_version: "ingestion_task_result.v1",
			task_id: "task_01",
			run_id: "run_01",
			registry_task_id: "official_web.capture",
			output_contract: "official_web_source_manifest.v1",
			result_ref: {
				byte_size: 256,
				kind: "object_store",
				uri: "s3://campus-agent-source/official_web/site/runs/run_01/result.json",
				digest,
			},
			summary: { pages_captured: 12, pages_failed: 1 },
		};

		expect(validateIngestionTaskResult(result).ok).toBe(true);
		expect(
			validateIngestionTaskResult({
				...result,
				artifact_refs: [result.result_ref],
			}).ok,
		).toBe(false);
		expect(
			validateIngestionTaskResult({
				...result,
				summary: { message: "x".repeat(5000) },
			}).ok,
		).toBe(false);
		expect(
			validateIngestionTaskResult({
				...result,
				summary: { InvalidKey: true },
			}).ok,
		).toBe(false);
	});

	it("validates ingestion release manifests as a shared contract", () => {
		const manifest = {
			schema_version: "ingestion_release_manifest.v2",
			release_id: "release-001",
			corpus: "curriculum",
			collection: "curriculum_plan",
			artifacts: [
				{ byte_size: 512, kind: "object_store", uri: "s3://bucket/release.json", digest },
			],
		};
		expect(validateIngestionReleaseManifest(manifest).ok).toBe(true);
		expect(validateIngestionReleaseManifest({ ...manifest, corpus: "" }).ok).toBe(false);
	});
});
