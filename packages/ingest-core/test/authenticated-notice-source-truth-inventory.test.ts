import { describe, expect, it } from "vitest";
import {
	buildAuthenticatedNoticeSourceTruthInventoryEntriesFromRecords,
	buildAuthenticatedNoticeSourceTruthParentSnapshotFromPayloads,
	deriveAuthenticatedNoticeRiskLabel,
	inventoryEntryFromAuthenticatedNoticeParentSnapshot,
	parseAuthenticatedNoticeSourceTruthInventoryEntry,
	selectLatestAuthenticatedNoticeParentRecords,
} from "../src/index.ts";

describe("authenticated notice source-truth inventory", () => {
	it("rejects legacy inventory rows without the current profile fields", () => {
		const legacy = inventoryEntry("000004") as Record<string, unknown>;
		delete legacy.attachment_ref_count;
		delete legacy.multimodal_processing_required_count;
		delete legacy.notice_risk_label;
		delete legacy.attachment_mix_score;
		delete legacy.has_text_table_attachment;
		delete legacy.has_spatial_attachment;
		delete legacy.has_reference_only_attachment;
		legacy.obsolete_profile_count = 3;

		expect(() => parseAuthenticatedNoticeSourceTruthInventoryEntry(legacy)).toThrow(
			"attachment_ref_count",
		);
	});

	it("keeps one latest parent record per notice using raw ingestion time first", () => {
		const older = documentRecord("notice:synthetic_internal_portal:355122", "sha256:older");
		const newer = documentRecord("notice:synthetic_internal_portal:355122", "sha256:newer");

		const selected = selectLatestAuthenticatedNoticeParentRecords({
			rawRecords: [
				rawRecord("asset:notice:synthetic_internal_portal:355122", "sha256:older", {
					ingestion_timestamp: "2026-04-01T00:00:00+00:00",
				}),
				rawRecord("asset:notice:synthetic_internal_portal:355122", "sha256:newer", {
					ingestion_timestamp: "2026-04-26T00:00:00+00:00",
				}),
			],
			records: [newer, older],
		});

		expect(selected.map((record) => record.version_id)).toEqual(["sha256:newer"]);
	});

	it("builds parent snapshot and inventory entry from source-truth payloads", () => {
		const record = documentRecord("notice:synthetic_internal_portal:355123", "sha256:current", {
			embedding_model: "Qwen3-Embedding-4B",
			processed_object_keys: [
				"internal_portal/asset/2026/sha/source-truth/notice-manifest.json",
				"internal_portal/asset/2026/sha/source-truth/content-blocks.jsonl",
				"internal_portal/asset/2026/sha/source-truth/attachment-refs.jsonl",
			],
		});
		const raw = rawRecord("asset:notice:synthetic_internal_portal:355123", "sha256:current");

		const snapshot = buildAuthenticatedNoticeSourceTruthParentSnapshotFromPayloads({
			attachmentRefs: [
				attachmentRef({
					attachment_ref_id: "attachment-0001",
					byte_size: 2048,
					content_kind: "document",
					content_sha256: "d".repeat(64),
					mime_type: "application/pdf",
					object_key: "source/notice/355123/attachment.pdf",
					storage_provider: "object_store",
				}),
				attachmentRef({
					attachment_ref_id: "attachment-0002",
					content_kind: "inline_image",
					ingest_status: "reference_only",
					mime_type: "image/png",
				}),
			],
			attachmentRefsKey: "internal_portal/asset/2026/sha/source-truth/attachment-refs.jsonl",
			contentBlocksKey: "internal_portal/asset/2026/sha/source-truth/content-blocks.jsonl",
			noticeManifest: {
				notice_browser_url: "https://portal.example.edu/notice/355123",
				notice_release_time: "2026-04-26 09:30",
				notice_title_normalized: "班车安排",
				notice_type_names: ["后勤通知"],
				portal_print_url: "https://portal.example.edu/print/355123",
				source_home_url: "https://portal.example.edu",
			},
			noticeManifestKey: "internal_portal/asset/2026/sha/source-truth/notice-manifest.json",
			rawRecord: raw,
			record,
			sourceArtifactKeys: record.processed_object_keys,
		});
		const entry = inventoryEntryFromAuthenticatedNoticeParentSnapshot(snapshot);

		expect(entry).toMatchObject({
			attachment_document_count: 1,
			attachment_mix_score: 3,
			attachment_ref_count: 2,
			has_reference_only_attachment: true,
			has_text_table_attachment: true,
			notice_id: "355123",
			notice_risk_label: "body_with_text_attachments",
			ocr_required_count: 0,
			planning_weight: 2,
			reference_only_count: 1,
			site_id: "synthetic_internal_portal",
			source_home_url: "https://portal.example.edu",
			text_extractable_count: 1,
		});
		expect(entry.parent_snapshot).toMatchObject({
			notice_title: "班车安排",
			expected_attachment_documents: [
				expect.objectContaining({
					attachment_ref_id: "attachment-0001",
					classification: "text_extractable",
				}),
			],
		});
	});

	it("builds inventory entries from source-truth records and payloads", () => {
		const older = documentRecord("notice:synthetic_internal_portal:355124", "sha256:older", {
			processed_object_keys: sourceTruthKeys("older"),
		});
		const current = documentRecord("notice:synthetic_internal_portal:355124", "sha256:current", {
			processed_object_keys: sourceTruthKeys("current"),
		});

		const entries = buildAuthenticatedNoticeSourceTruthInventoryEntriesFromRecords({
			attachmentRefsByKey: {
				"internal_portal/current/source-truth/attachment-refs.jsonl": [
					attachmentRef({
						attachment_ref_id: "attachment-0001",
						byte_size: 2048,
						content_kind: "document",
						content_sha256: "e".repeat(64),
						mime_type: "application/pdf",
						object_key: "source/notice/355124/attachment.pdf",
						storage_provider: "object_store",
					}),
				],
				"internal_portal/older/source-truth/attachment-refs.jsonl": [],
			},
			noticeManifestByKey: {
				"internal_portal/current/source-truth/notice-manifest.json": {
					notice_title_normalized: "当前通知",
					source_home_url: "https://portal.example.edu",
				},
				"internal_portal/older/source-truth/notice-manifest.json": {
					notice_title_normalized: "旧通知",
					source_home_url: "https://portal.example.edu",
				},
			},
			rawRecords: [
				rawRecord("asset:notice:synthetic_internal_portal:355124", "sha256:older", {
					ingestion_timestamp: "2026-04-01T00:00:00+00:00",
				}),
				rawRecord("asset:notice:synthetic_internal_portal:355124", "sha256:current", {
					ingestion_timestamp: "2026-04-26T00:00:00+00:00",
				}),
			],
			records: [older, current],
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			attachment_ref_count: 1,
			notice_id: "355124",
			notice_risk_label: "body_with_text_attachments",
			version_id: "sha256:current",
		});
		expect(entries[0]?.parent_snapshot).toMatchObject({
			notice_title: "当前通知",
		});
	});

	it("fails closed when source-truth inventory records reference missing raw truth", () => {
		const record = documentRecord("notice:synthetic_internal_portal:355125", "sha256:current", {
			processed_object_keys: sourceTruthKeys("missing-raw"),
		});

		expect(() =>
			buildAuthenticatedNoticeSourceTruthInventoryEntriesFromRecords({
				attachmentRefsByKey: {
					"internal_portal/missing-raw/source-truth/attachment-refs.jsonl": [],
				},
				noticeManifestByKey: {
					"internal_portal/missing-raw/source-truth/notice-manifest.json": {
						notice_title_normalized: "缺失 raw",
					},
				},
				rawRecords: [],
				records: [record],
			}),
		).toThrow("requires persisted raw asset registry truth");
	});

	it("labels spatial plus text/reference attachments as mixed high risk", () => {
		expect(
			deriveAuthenticatedNoticeRiskLabel({
				attachmentRefCount: 2,
				hasReferenceOnlyAttachment: true,
				hasSpatialAttachment: true,
				hasTextTableAttachment: false,
				hasUnsupportedBinaryAttachment: false,
			}),
		).toBe("mixed_high_risk");
	});
});

function inventoryEntry(noticeId: string) {
	return {
		attachment_document_count: 0,
		attachment_mix_score: 0,
		attachment_ref_count: 0,
		attachment_refs_key: `source/${noticeId}/attachment-refs.jsonl`,
		collection: "internal_notice",
		content_blocks_key: `source/${noticeId}/content-blocks.jsonl`,
		corpus: "campus_notices",
		document_id: `notice:synthetic_internal_portal:${noticeId}`,
		embedding_model: "Qwen3-Embedding-4B",
		has_reference_only_attachment: false,
		has_spatial_attachment: false,
		has_text_table_attachment: false,
		has_unsupported_binary_attachment: false,
		multimodal_processing_required_count: 0,
		notice_id: noticeId,
		notice_manifest_key: `source/${noticeId}/notice-manifest.json`,
		notice_risk_label: "body_only",
		ocr_required_count: 0,
		parent_snapshot: { notice_id: noticeId },
		planning_weight: 1,
		raw_asset_id: `asset:${noticeId}`,
		raw_version_id: `sha256:${noticeId}`,
		reference_only_count: 0,
		revision_track: "source-faithful",
		site_id: "synthetic_internal_portal",
		source_home_url: "https://portal.example.edu/home",
		text_extractable_count: 0,
		unsupported_binary_count: 0,
		updated_at: "2026-04-06T00:00:00.000Z",
		version_id: `sha256:${noticeId}`,
	};
}

function documentRecord(
	documentId: string,
	versionId: string,
	overrides: Partial<Record<string, unknown>> = {},
) {
	const noticeId = documentId.split(":")[2] ?? "unknown";
	return {
		canonical_markdown_object_key: null,
		cleaning_policy_version: "",
		collection: "internal_notice",
		content_hash: versionId,
		corpus: "campus_notices",
		document_id: documentId,
		document_units_object_key: null,
		effective_date: null,
		embedding_model: "Qwen3-Embedding-4B",
		entitlement_groups: ["campus_members"],
		import_source: "authenticated_notice_source_truth_materialize",
		ingestion_timestamp: "2026-04-06T00:00:00+00:00",
		is_current: true,
		layout_elements_object_key: null,
		parser_version: "authenticated_notice_source_truth_v1",
		policy_projection_version: "",
		processed_object_keys: [
			`campus_notices/source-truth/${documentId}/notice-manifest.json`,
			`campus_notices/source-truth/${documentId}/content-blocks.jsonl`,
			`campus_notices/source-truth/${documentId}/attachment-refs.jsonl`,
		],
		provenance_status: "",
		provider_response_object_key: null,
		published_date: null,
		raw_asset: {
			raw_asset_id: `asset:notice:synthetic_internal_portal:${noticeId}`,
			raw_version_id: versionId,
		},
		revision_track: "source-faithful",
		source_channel: "internal_portal",
		source_observations: [],
		source_uri: `https://portal.example.edu/${documentId}`,
		status: "active",
		supersedes_version_id: null,
		version_id: versionId,
		visibility_level: "restricted",
		visibility_scope: "campus",
		...overrides,
	};
}

function rawRecord(
	rawAssetId: string,
	rawVersionId: string,
	overrides: Partial<Record<string, unknown>> = {},
) {
	return {
		asset_kind: "",
		asset_subkind: "",
		byte_size: null,
		classification_confidence: null,
		collection: "internal_notice",
		content_hash: rawVersionId,
		content_type: null,
		corpus: "campus_notices",
		file_extension: "",
		image_height: null,
		image_width: null,
		import_source: "authenticated_notice_source_truth_materialize",
		ingestion_timestamp: "2026-04-06T00:00:00+00:00",
		object_key: `campus_notices/raw/${rawAssetId}/${rawVersionId}/detail-response.json`,
		page_count: null,
		raw_asset_id: rawAssetId,
		raw_source_uri: `https://portal.example.edu/raw/${rawAssetId}`,
		raw_version_id: rawVersionId,
		source_filename: "detail-response.json",
		...overrides,
	};
}

function sourceTruthKeys(label: string): string[] {
	return [
		`internal_portal/${label}/source-truth/notice-manifest.json`,
		`internal_portal/${label}/source-truth/content-blocks.jsonl`,
		`internal_portal/${label}/source-truth/attachment-refs.jsonl`,
	];
}

function attachmentRef(overrides: Partial<Record<string, unknown>>) {
	return {
		attachment_ref_id: "attachment-0001",
		byte_size: null,
		content_kind: "document",
		content_sha256: null,
		final_url: null,
		ingest_status: null,
		last_error_class: null,
		last_http_status: null,
		mime_type: null,
		normalized_source_url: null,
		object_key: null,
		original_filename: null,
		origin_scope: null,
		raw_asset_id: "asset:notice:synthetic_internal_portal:355123",
		raw_version_id: "sha256:current",
		ref_order: 1,
		relation_source: "notice_attachment",
		resource_role: "attachment",
		schema_version: "authenticated_notice_attachment_ref_v1",
		source_url: null,
		storage_provider: null,
		terminal_reason: null,
		...overrides,
	};
}
