import { describe, expect, it } from "vitest";
import {
	validateInternalPortalFileReleaseSource,
	validateInternalPortalMeta,
	validateInternalPortalNoticeSource,
	validateInternalPortalNoticeSyncState,
	validateLegacyInternalPortalNoticeSyncState,
} from "../src/index.ts";

const digest = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("ingestion task contracts", () => {
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

	it("validates the notice half-open maintenance boundaries", () => {
		const state = {
			covered_from: "2026-01-01",
			covered_until: "2026-07-26",
			schema_version: "internal_portal_notice_sync_state.v3",
			updated_at: "2026-07-25T09:00:00.000Z",
		};

		expect(validateInternalPortalNoticeSyncState(state).ok).toBe(true);
		expect(
			validateInternalPortalNoticeSyncState({ ...state, covered_until: "2026/07/26" }).ok,
		).toBe(false);
		expect(
			validateInternalPortalNoticeSyncState({ ...state, covered_until: "2025-12-31" }).ok,
		).toBe(false);
		expect(
			validateInternalPortalNoticeSyncState({
				...state,
				covered_from: "2026-01-01",
				covered_until: "2026-01-01",
			}).ok,
		).toBe(true);
		expect(
			validateInternalPortalNoticeSyncState({
				...state,
				covered_from: null,
				covered_until: null,
			}).ok,
		).toBe(true);
		expect(validateInternalPortalNoticeSyncState({ ...state, covered_until: null }).ok).toBe(false);
		expect(validateInternalPortalNoticeSyncState({ ...state, notice_type: "5" }).ok).toBe(false);
		expect(
			validateLegacyInternalPortalNoticeSyncState({
				head_notice_id: 355119,
				history_covered_from: "2026-01-01",
				schema_version: "internal_portal_notice_sync_state.v2",
				updated_at: "2026-07-25T09:00:00.000Z",
			}).ok,
		).toBe(true);
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
