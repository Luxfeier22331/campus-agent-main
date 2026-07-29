import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type IngestionTaskEnvelope,
	type IngestionTaskResult,
	validateCanonicalDocumentUnit,
	validateCanonicalDocumentUnitsJsonl,
	validateCanonicalDocumentUnitV2,
	validateIngestionTaskEnvelope,
	validateIngestionTaskRegistry,
	validateIngestionTaskResult,
	validateInternalPortalFileReleaseCaptureResult,
	validateInternalPortalFileReleaseSource,
	validateInternalPortalNoticeSource,
	validateInternalPortalNoticeSyncState,
	validateRetrievalChunkSetV2,
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

	it("validates the formal section-to-retrieval-chunk contract", () => {
		const section = {
			schema_version: "canonical_document_unit.v2",
			document_scope: "regulations",
			document_id: "student-handbook",
			version_id: "2026",
			section_id: "section-1",
			parent_section_id: null,
			ordinal: 0,
			anchor: "#section-1",
			document_title: "学生手册",
			section_title: "第一章",
			canonical_url: "https://example.test/handbook#section-1",
			content: "hello",
			content_sha256: digest,
			metadata: {},
		};
		const chunk = {
			schema_version: "retrieval_chunk.v2",
			document_scope: section.document_scope,
			document_id: section.document_id,
			version_id: section.version_id,
			section_id: section.section_id,
			chunk_id: "retrieval:chunk-1",
			ordinal: 0,
			token_count: 1,
			text: "hello",
			text_sha256: digest,
			metadata: {},
		};

		expect(validateCanonicalDocumentUnitV2(section).ok).toBe(true);
		expect(
			validateRetrievalChunkSetV2({
				schema_version: "retrieval_chunk_set.v2",
				chunk_count: 1,
				chunks: [chunk],
				error_count: 0,
				errors: [],
			}).ok,
		).toBe(true);
		expect(
			validateRetrievalChunkSetV2({
				schema_version: "retrieval_chunk_set.v2",
				chunk_count: 2,
				chunks: [chunk],
				error_count: 0,
				errors: [],
			}).ok,
		).toBe(false);
	});

	it("keeps the task envelope small and derives execution metadata from the registry", () => {
		const envelope: IngestionTaskEnvelope = {
			input_ref: {
				byte_size: 128,
				digest,
				kind: "object_store",
				uri: "s3://campus-agent-source/requests/internal-portal-file-release.json",
			},
			registry_task_id: "internal_portal.file_release.capture",
			run_id: "run_01",
			schema_version: "ingestion_task_envelope.v3",
			task_id: "task_01",
		};

		expect(validateIngestionTaskEnvelope(envelope).ok).toBe(true);
		expect(
			validateIngestionTaskEnvelope({ ...envelope, corpus: "authenticated_documents" }).ok,
		).toBe(false);
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

	it("accepts only Rust kernel registry declarations", () => {
		expect(validateIngestionTaskRegistry(loadAssertion("task-registry.valid.json")).ok).toBe(true);
		expect(
			validateIngestionTaskRegistry(loadAssertion("task-registry.invalid-python-adapter.json")).ok,
		).toBe(false);
		expect(
			validateIngestionTaskRegistry({
				schema_version: "ingestion_task_registry.v3",
				tasks: [
					{
						executor_kind: "source_collector",
						input_contract: "unsupported_capture_request.v1",
						output_contract: "unsupported_source_manifest.v1",
						registry_task_id: "unsupported.capture",
					},
				],
			}).ok,
		).toBe(false);
	});

	it("validates one immutable notice source object", () => {
		const source = {
			attachments: [
				{
					notice_annex_id: "annex-1",
					notice_annex_name: "附件.pdf",
					notice_annex_path: "/download/1",
					suffix: "pdf",
					type: "application/pdf",
				},
			],
			notice_content: "<p>正文</p>",
			notice_id: 355119,
			notice_link: null,
			notice_release_time: "2026-07-25 09:00:00",
			notice_title: "示例通知",
			notice_type: "5",
			notice_type_name: "办公通知",
			organization_id: "dept-1",
			organization_name: "教务处",
			schema_version: "internal_portal_notice_source.v1",
			site_id: "muc_internal_portal",
		};

		expect(validateInternalPortalNoticeSource(source).ok).toBe(true);
		expect(
			validateInternalPortalNoticeSource({
				...source,
				notice_create_time: "2026-07-25 08:00:00",
			}).ok,
		).toBe(false);
		expect(validateInternalPortalNoticeSource({ ...source, notice_id: 0 }).ok).toBe(false);
		expect(validateInternalPortalNoticeSource({ ...source, unexpected: true }).ok).toBe(false);
	});

	it("validates the fixed file-release source object", () => {
		const source = {
			department: "教务处",
			explanation_department: null,
			file: {
				byte_size: 10,
				content_type: "application/pdf",
				digest,
				object_key: "internal_portal/muc/file-releases/646/file.pdf",
				original_filename: "通知.pdf",
			},
			file_code: "校发〔2026〕1号",
			file_release_id: 646,
			published_at: "2026-07-25 09:00:00",
			schema_version: "internal_portal_file_release_source.v1",
			site_id: "muc_internal_portal",
			title: "示例文件",
		};

		expect(validateInternalPortalFileReleaseSource(source).ok).toBe(true);
		expect(validateInternalPortalFileReleaseSource({ ...source, file_release_id: 0 }).ok).toBe(
			false,
		);
		expect(validateInternalPortalFileReleaseSource({ ...source, request: {} }).ok).toBe(false);
	});

	it("validates a file-release capture result with one source reference", () => {
		const result = {
			file_release_id: 646,
			schema_version: "internal_portal_file_release_capture_result.v1",
			source_ref: {
				byte_size: 256,
				digest,
				kind: "object_store",
				uri: "s3://campus-agent-source/internal_portal/muc/file-releases/646/source.json",
			},
		};

		expect(validateInternalPortalFileReleaseCaptureResult(result).ok).toBe(true);
		expect(
			validateInternalPortalFileReleaseCaptureResult({ ...result, export_ref: result.source_ref })
				.ok,
		).toBe(false);
	});

	it("validates the notice incremental and history boundaries", () => {
		const state = {
			history_covered_from: "2026-01-01",
			incremental_head_id: 355119,
			max_captured_id: 355119,
			min_captured_id: 310001,
			schema_version: "internal_portal_notice_sync_state.v1",
			site_id: "muc_internal_portal",
			updated_at: "2026-07-25T09:00:00.000Z",
		};

		expect(validateInternalPortalNoticeSyncState(state).ok).toBe(true);
		expect(
			validateInternalPortalNoticeSyncState({ ...state, history_covered_from: "2026/01/01" }).ok,
		).toBe(false);
		expect(validateInternalPortalNoticeSyncState({ ...state, notice_type: "5" }).ok).toBe(false);
	});

	it("validates a single bounded result reference", () => {
		const result: IngestionTaskResult = {
			output_contract: "internal_portal_file_release_capture_result.v2",
			registry_task_id: "internal_portal.file_release.capture",
			result_ref: {
				byte_size: 256,
				digest,
				kind: "object_store",
				uri: "s3://campus-agent-source/internal_portal/site/runs/run_01/result.json",
			},
			run_id: "run_01",
			schema_version: "ingestion_task_result.v1",
			summary: { pages_captured: 12, pages_failed: 1 },
			task_id: "task_01",
		};

		expect(validateIngestionTaskResult(result).ok).toBe(true);
		expect(validateIngestionTaskResult({ ...result, artifact_refs: [result.result_ref] }).ok).toBe(
			false,
		);
		expect(
			validateIngestionTaskResult({ ...result, summary: { message: "x".repeat(5000) } }).ok,
		).toBe(false);
		expect(validateIngestionTaskResult({ ...result, summary: { InvalidKey: true } }).ok).toBe(
			false,
		);
	});
});
