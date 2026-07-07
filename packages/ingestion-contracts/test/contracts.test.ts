import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type IngestionArtifactRef,
	type IngestionTaskEnvelope,
	validateCanonicalDocumentUnit,
	validateCanonicalDocumentUnitsJsonl,
	validateIngestionReleaseManifest,
	validateIngestionTaskEnvelope,
	validateIngestionTaskRegistry,
} from "../src/index.ts";

const assertionRoot = join(import.meta.dirname, "..", "assertions");

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

		const result = validateCanonicalDocumentUnit({
			document_id: "doc-001",
			metadata: {},
			text: "legacy shape",
			unit_id: "unit-001",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("doc_id is required");
			expect(result.errors).toContain("chunk_id is required");
			expect(result.errors).toContain("clean_text is required");
		}
	});

	it("exports the shared task envelope DTO used by runtime clients", () => {
		const inputRef: IngestionArtifactRef = {
			kind: "object_store",
			uri: "s3://campus-agent-source/official_web/run/source-truth-bundle.json",
		};
		const envelope: IngestionTaskEnvelope = {
			schema_version: "ingestion_task_envelope.v2",
			task_id: "task_01",
			run_id: "run_01",
			source_family: "official_web",
			source_channel: "official_web",
			corpus: "official_web",
			collection: "stable_reference",
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			input_ref: inputRef,
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
			idempotency_key: "official_web/stable_reference/source_truth_materialize/run_01",
			created_by: "test",
			created_at: "2026-03-29T08:17:33.000Z",
		};

		expect(validateIngestionTaskEnvelope(envelope).ok).toBe(true);
	});

	it("validates ingestion release manifests as a shared contract", () => {
		const manifest = {
			schema_version: "ingestion_release_manifest.v1",
			release_id: "release-001",
			corpus: "official_web",
			collection: "stable_reference",
			artifacts: [
				{
					kind: "object_store",
					uri: "s3://bucket/release.json",
					digest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				},
			],
		};

		expect(validateIngestionReleaseManifest(manifest).ok).toBe(true);

		const result = validateIngestionReleaseManifest({
			...manifest,
			corpus: "",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("corpus must be non-empty");
		}
	});

	it("accepts a valid task envelope and rejects missing idempotency", () => {
		expect(validateIngestionTaskEnvelope(loadAssertion("task-envelope.valid.json")).ok).toBe(true);

		const result = validateIngestionTaskEnvelope(
			loadAssertion("task-envelope.invalid-missing-idempotency.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("idempotency_key is required");
		}
	});

	it("enforces JSON Schema constraints for task envelopes", () => {
		const validEnvelope = loadAssertion("task-envelope.valid.json") as Record<string, unknown>;

		const badTimestamp = validateIngestionTaskEnvelope({
			...validEnvelope,
			created_at: "not-a-date",
		});
		expect(badTimestamp.ok).toBe(false);
		if (!badTimestamp.ok) {
			expect(badTimestamp.errors.join("\n")).toContain("created_at");
			expect(badTimestamp.errors.join("\n")).toContain("date-time");
		}

		const extraField = validateIngestionTaskEnvelope({
			...validEnvelope,
			unexpected_field: true,
		});
		expect(extraField.ok).toBe(false);
		if (!extraField.ok) {
			expect(extraField.errors.join("\n")).toContain("unexpected_field");
		}
	});

	it("accepts active registry task kinds only", () => {
		expect(validateIngestionTaskRegistry(loadAssertion("task-registry.valid.json")).ok).toBe(true);

		const result = validateIngestionTaskRegistry({
			schema_version: "ingestion_task_registry.v2",
			source_family: "curriculum",
			corpus: "curriculum",
			collection: "curriculum_plan",
			tasks: [
				{
					registry_task_id: "alias_publish",
					task_kind: "alias_publish",
					executor_kind: "ts_control",
					input_contract: "ingestion_release_manifest.v1",
					output_contract: "ingestion_alias_publish_closeout.v1",
				},
			],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("tasks[0].task_kind is not supported: alias_publish");
		}
	});

	it("enforces JSON Schema constraints for task registries", () => {
		const validRegistry = loadAssertion("task-registry.valid.json") as Record<string, unknown>;
		const extraField = validateIngestionTaskRegistry({
			...validRegistry,
			tasks: [
				{
					...((validRegistry.tasks as Record<string, unknown>[])[0] ?? {}),
					extra_task_field: true,
				},
			],
		});
		expect(extraField.ok).toBe(false);
		if (!extraField.ok) {
			expect(extraField.errors.join("\n")).toContain("extra_task_field");
		}

		const missingKernelId = validateIngestionTaskRegistry({
			schema_version: "ingestion_task_registry.v2",
			source_family: "regulations",
			corpus: "regulations",
			collection: "student_rules",
			tasks: [
				{
					registry_task_id: "chunk_prepare",
					task_kind: "chunk_prepare",
					executor_kind: "rust_kernel",
					input_contract: "document_units.v1",
					output_contract: "chunk_prepare_result.v1",
				},
			],
		});
		expect(missingKernelId.ok).toBe(false);
		if (!missingKernelId.ok) {
			expect(missingKernelId.errors.join("\n")).toContain("kernel_id");
		}
	});

	it("rejects post-source-truth task kinds until explicit handlers are admitted", () => {
		const registry = {
			schema_version: "ingestion_task_registry.v2",
			source_family: "authenticated_notice",
			corpus: "campus_notices",
			collection: "internal_notice",
			tasks: [
				{
					registry_task_id: "document_projection_materialize",
					task_kind: "document_projection_materialize",
					executor_kind: "ts_control",
					input_contract: "authenticated_notice_source_truth.v1",
					output_contract: "authenticated_notice_document_projection.v1",
				},
				{
					registry_task_id: "read_model_materialize",
					task_kind: "read_model_materialize",
					executor_kind: "ts_control",
					input_contract: "authenticated_notice_document_projection.v1",
					output_contract: "internal_notice_read_model_projection.v1",
				},
				{
					registry_task_id: "derived_scope_materialize",
					task_kind: "derived_scope_materialize",
					executor_kind: "ts_control",
					input_contract: "authenticated_notice_source_truth.v1",
					output_contract: "institutional_regulations_candidate_scope.v1",
				},
			],
		};

		const result = validateIngestionTaskRegistry(registry);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain(
				"tasks[0].task_kind is not supported: document_projection_materialize",
			);
			expect(result.errors).toContain(
				"tasks[1].task_kind is not supported: read_model_materialize",
			);
			expect(result.errors).toContain(
				"tasks[2].task_kind is not supported: derived_scope_materialize",
			);
		}
	});

	it("rejects python adapters in repo-owned task registries", () => {
		const result = validateIngestionTaskRegistry(
			loadAssertion("task-registry.invalid-python-adapter.json"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContain("tasks[0].executor_kind is not supported: python_adapter");
		}
	});

	it("rejects unwired collector and provider registry declarations", () => {
		for (const [taskKind, executorKind] of [
			[["source", "capture"].join("_"), ["crawlee", "collector"].join("_")],
			[["provider", "extract"].join("_"), ["provider", "activity"].join("_")],
		]) {
			const result = validateIngestionTaskRegistry({
				schema_version: "ingestion_task_registry.v2",
				source_family: "custom_family",
				corpus: "custom",
				collection: "new_collection",
				tasks: [
					{
						registry_task_id: taskKind,
						task_kind: taskKind,
						executor_kind: executorKind,
						input_contract: "custom_input.v1",
						output_contract: "custom_output.v1",
					},
				],
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors).toContain(`tasks[0].task_kind is not supported: ${taskKind}`);
				expect(result.errors).toContain(`tasks[0].executor_kind is not supported: ${executorKind}`);
			}
		}
	});
});
