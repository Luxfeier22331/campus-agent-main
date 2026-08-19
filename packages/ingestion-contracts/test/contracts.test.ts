import { describe, expect, it } from "vitest";
import {
	validateCanonicalDocumentUnit,
	validateCanonicalDocumentUnitsJsonl,
	validateCanonicalDocumentUnitV2,
	validateInternalPortalFileReleaseSource,
	validateInternalPortalMeta,
	validateInternalPortalNoticeSource,
	validateInternalPortalNoticeSyncState,
	validateRetrievalChunkSetV2,
} from "../src/index.ts";

const digest = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

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
			external_url: null,
			is_external: false,
			notice_content_html: "<p>正文</p>",
			notice_id: 355119,
			notice_release_time: "2026-07-25 09:00:00",
			notice_title: "示例通知",
			notice_type: 5,
			organization_id: "dept-1",
			schema_version: "internal_portal_notice_source.v2",
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
		expect(
			validateInternalPortalNoticeSource({
				...source,
				external_url: "https://mp.weixin.qq.com/s/example",
				is_external: true,
			}).ok,
		).toBe(true);
		expect(
			validateInternalPortalNoticeSource({ ...source, external_url: null, is_external: true }).ok,
		).toBe(false);
		expect(
			validateInternalPortalNoticeSource({
				...source,
				external_url: "https://example.edu/external",
				is_external: false,
			}).ok,
		).toBe(false);
		expect(
			validateInternalPortalNoticeSource({
				...source,
				external_url: "ftp://example.edu/external",
				is_external: true,
			}).ok,
		).toBe(false);
		expect(validateInternalPortalNoticeSource({ ...source, notice_source: 0 }).ok).toBe(false);
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

	it("validates the notice incremental and history boundaries", () => {
		const state = {
			head_notice_id: 355119,
			history_covered_from: "2026-01-01",
			schema_version: "internal_portal_notice_sync_state.v2",
			updated_at: "2026-07-25T09:00:00.000Z",
		};

		expect(validateInternalPortalNoticeSyncState(state).ok).toBe(true);
		expect(
			validateInternalPortalNoticeSyncState({ ...state, history_covered_from: "2026/01/01" }).ok,
		).toBe(false);
		expect(validateInternalPortalNoticeSyncState({ ...state, notice_type: "5" }).ok).toBe(false);
	});

	it("validates the portal-wide type and organization mappings", () => {
		const meta = {
			notice_types: { "5": "办公通知", "6": "教学通知" },
			organizations: { "00007": "党委保卫部、保卫处" },
			schema_version: "internal_portal_meta.v1",
			updated_at: "2026-08-11T02:30:07.000Z",
		};

		expect(validateInternalPortalMeta(meta).ok).toBe(true);
		expect(validateInternalPortalMeta({ ...meta, notice_types: { zero: "错误" } }).ok).toBe(false);
		expect(validateInternalPortalMeta({ ...meta, site_id: "muc_internal_portal" }).ok).toBe(false);
	});
});
