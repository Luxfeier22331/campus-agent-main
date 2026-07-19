import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type IngestionTaskEnvelope,
	type IngestionTaskResult,
	validateCanonicalDocumentUnit,
	validateCanonicalDocumentUnitsJsonl,
	validateIngestionOfflineRelease,
	validateIngestionTaskEnvelope,
	validateIngestionTaskRegistry,
	validateIngestionTaskResult,
	validateInternalPortalNoticeCheckpoint,
	validateInternalPortalStageResult,
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

	it("validates source collector, TypeScript kernel, and Rust registry declarations", () => {
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

	it("requires unique notice checkpoints and materialized release items", () => {
		const checkpoint = {
			captured_at: "2026-07-17T00:01:00.000Z",
			next: [{ last_released_notice_id: 110, notice_type: "5" }],
			previous: [{ last_released_notice_id: 100, notice_type: "5" }],
			schema_version: "internal_portal_notice_checkpoint.v1",
		};
		expect(validateInternalPortalNoticeCheckpoint(checkpoint).ok).toBe(true);
		expect(
			validateInternalPortalNoticeCheckpoint({
				...checkpoint,
				next: [
					{ last_released_notice_id: 110, notice_type: "5" },
					{ last_released_notice_id: 111, notice_type: "5" },
				],
			}).ok,
		).toBe(false);

		const releaseItem = {
			artifacts: [
				"source_manifest",
				"content_blocks",
				"attachment_refs",
				"canonical_markdown",
				"canonical_document_units",
			].map((role) => ({
				byte_size: 10,
				digest,
				kind: "object_store",
				role,
				uri: `s3://derived/notice/${role}`,
			})),
			item_id: "asset:notice:110",
			version_id: digest,
		};
		const stageResult = {
			artifacts: [
				{
					byte_size: 20,
					digest,
					kind: "object_store",
					role: "canonical_document_units",
					uri: "s3://derived/notice/units.jsonl",
				},
			],
			items: [releaseItem],
			registry_task_id: "campus_notices.internal_notice.materialize",
			run_id: "run-110",
			schema_version: "internal_portal_notice_materialization_result.v1",
			summary: { document_count: 1 },
			task_id: "run-110:materialize",
		};
		expect(validateInternalPortalStageResult(stageResult).ok).toBe(true);
		expect(validateInternalPortalStageResult({ ...stageResult, items: undefined }).ok).toBe(false);
		expect(
			validateInternalPortalStageResult({
				...stageResult,
				items: [{ ...releaseItem, artifacts: releaseItem.artifacts.slice(0, -1) }],
			}).ok,
		).toBe(false);
		expect(
			validateInternalPortalStageResult({ ...stageResult, items: [releaseItem, releaseItem] }).ok,
		).toBe(false);

		const fileItem = {
			artifacts: ["source_manifest", "content_blocks", "released_file"].map((role) => ({
				byte_size: 10,
				digest,
				kind: "object_store",
				role,
				uri: `s3://derived/file/${role}`,
			})),
			item_id: "asset:file-release:646",
			version_id: digest,
		};
		const fileStageResult = {
			artifacts: [fileItem.artifacts.at(-1)],
			items: [fileItem],
			registry_task_id: "authenticated_documents.file_release_source.materialize",
			run_id: "run-646",
			schema_version: "internal_portal_file_release_materialization_result.v1",
			summary: { file_count: 1 },
			task_id: "run-646:materialize",
		};
		expect(validateInternalPortalStageResult(fileStageResult).ok).toBe(true);
		expect(
			validateInternalPortalStageResult({
				...fileStageResult,
				items: [{ ...fileItem, artifacts: fileItem.artifacts.slice(0, -1) }],
			}).ok,
		).toBe(false);
	});

	it("rejects duplicate item identities in a complete offline release", () => {
		const item = {
			artifacts: [
				{
					byte_size: 10,
					digest,
					kind: "object_store",
					role: "source_manifest",
					uri: "s3://derived/notice/manifest.json",
				},
			],
			item_id: "asset:notice:110",
			version_id: digest,
		};
		const release = {
			checkpoint: { notices: [{ last_released_notice_id: 110, notice_type: "5" }] },
			created_at: "2026-07-17T00:02:00.000Z",
			items: [item],
			pipeline: {
				run_id: "run-110",
				task_ids: ["run-110:capture", "run-110:materialize"],
				workflow_id: "ingestion/internal-portal-notice/run-110",
				workflow_run_id: "run-110",
			},
			previous_release_id: null,
			release_id: "release:run-110:v1",
			schema_version: "ingestion_offline_release.v1",
			source: { channel: "internal_portal", site_id: "muc", surface: "notice" },
			stream_id: "internal_portal:muc:notice",
			target: { collection: "internal_notice", corpus: "campus_notices" },
		};
		expect(validateIngestionOfflineRelease(release).ok).toBe(true);
		expect(validateIngestionOfflineRelease({ ...release, items: [item, item] }).ok).toBe(false);
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
});
