import { describe, expect, it } from "vitest";
import {
	type AuthenticatedNoticeRoutingSample,
	type AuthenticatedNoticeSourceTruthInventoryEntry,
	buildInternalNoticeConsumptionProjectionEntriesFromInventory,
} from "../src/index.ts";

describe("internal notice consumption projection builder", () => {
	it("builds notice-window rows from source-truth inventory", () => {
		const rows = buildInternalNoticeConsumptionProjectionEntriesFromInventory({
			inventoryEntries: [
				inventoryEntry({
					attachmentDocumentCount: 1,
					attachmentRefCount: 2,
					multimodalProcessingRequiredCount: 1,
					noticeId: "355122",
					ocrRequiredCount: 1,
					referenceOnlyCount: 1,
					textExtractableCount: 0,
					title: "关于两校区学生通勤班车增加班次的通知",
				}),
			],
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			answerability: "answerable",
			completeness_status: "complete",
			consumption_status: "retained_for_notice_query",
			default_agent: "notice",
			primary_role: "notice_window",
			semantic_owner: "notice_body",
			source_document_id: "notice:example_internal_portal:355122",
			source_notice_document_id: "notice:example_internal_portal:355122",
			source_notice_id: "355122",
			target_surface: "notice_level_query",
			temporal_policy: "announcement_window",
			unit_id: "notice_unit:notice:example_internal_portal:355122:notice_window",
		});
		expect(rows[0]?.role_metadata).toMatchObject({
			attachment_document_count: 1,
			attachment_ref_count: 2,
			multimodal_action_required: true,
			multimodal_consumption_policy: "process",
			notice_title: "关于两校区学生通勤班车增加班次的通知",
			ocr_required_count: 1,
			pending_multimodal_attachment_count: 1,
			reference_only_count: 1,
			source_multimodal_processing_required_count: 1,
			text_extractable_count: 0,
		});
	});

	it("adds typed candidate rows from explicit routing samples", () => {
		const rows = buildInternalNoticeConsumptionProjectionEntriesFromInventory({
			inventoryEntries: [
				inventoryEntry({
					noticeId: "355123",
					title: "关于两校区学生通勤班车增加班次的通知",
				}),
			],
			routingSamplesByNoticeId: new Map([
				[
					"355123",
					routingSample("355123", {
						noticeFamily: "facility_transport_classroom_status",
						suggestedConsumptionRoute: "service_status_candidate",
					}),
				],
			]),
		});

		expect(rows.map((row) => row.primary_role)).toEqual([
			"notice_window",
			"service_status_override",
		]);
		const serviceStatus = rows.find((row) => row.primary_role === "service_status_override");
		expect(serviceStatus).toMatchObject({
			answerability: "body_only_answerable",
			consumption_status: "ready_for_target_materialization",
			default_agent: "campus_services",
			target_surface: "campus_services/service_status_candidate",
			temporal_policy: "current_override",
		});
		expect(serviceStatus?.role_metadata).toMatchObject({
			notice_family: "facility_transport_classroom_status",
			notice_query_reason: "service_status_typed_materialization_candidate",
			service_status_candidate_kind: "transport_schedule",
			suggested_consumption_route: "service_status_candidate",
		});
	});

	it("keeps unsupported roster publications out of query surfaces", () => {
		const rows = buildInternalNoticeConsumptionProjectionEntriesFromInventory({
			inventoryEntries: [
				inventoryEntry({
					noticeId: "355326",
					title: "关于2026年优秀学生干部拟推荐名单公示",
				}),
			],
		});

		const roster = rows.find((row) => row.primary_role === "roster_publication");
		expect(roster).toMatchObject({
			answerability: "reference_only",
			completeness_status: "reference_only",
			consumption_status: "no_adoption",
			semantic_owner: "wrapper_notice",
			target_surface: "unsupported",
		});
		expect(roster?.role_metadata).toMatchObject({
			no_adoption_reason: "internal_restricted_publication_not_admitted",
		});
	});

	it("adds attachment form template query hints from source-truth projection plans", () => {
		const rows = buildInternalNoticeConsumptionProjectionEntriesFromInventory({
			inventoryEntries: [
				inventoryEntry({
					attachmentProjectionPlans: [
						{
							attachment_filename: "报名表.docx",
							attachment_ref_id: "attachment-0001",
							classification: "text_extractable",
							document_id: "notice_attachment:example_internal_portal:355778:attachment-0001",
							materialization_policy: "required_document",
						},
					],
					noticeId: "355778",
					title: "关于报名参加示例项目的通知",
				}),
			],
		});

		const formTemplate = rows.find((row) => row.primary_role === "attachment_form_template");
		expect(formTemplate).toMatchObject({
			answerability: "reference_only",
			consumption_status: "retained_for_notice_query",
			semantic_owner: "attachment_document",
			source_attachment_ref_ids: ["attachment-0001"],
			source_document_id: "notice_attachment:example_internal_portal:355778:attachment-0001",
			target_surface: "notice_level_query",
		});
		expect(formTemplate?.role_metadata).toMatchObject({
			attachment_filename: "报名表.docx",
			attachment_ref_id: "attachment-0001",
			notice_query_reason: "attachment_form_template_query_hint_only",
		});
	});
});

function inventoryEntry(input: {
	attachmentDocumentCount?: number;
	attachmentProjectionPlans?: Record<string, unknown>[];
	attachmentRefCount?: number;
	multimodalProcessingRequiredCount?: number;
	noticeId: string;
	ocrRequiredCount?: number;
	referenceOnlyCount?: number;
	textExtractableCount?: number;
	title: string;
}): AuthenticatedNoticeSourceTruthInventoryEntry {
	const attachmentProjectionPlans = input.attachmentProjectionPlans ?? [];
	return {
		attachment_document_count: input.attachmentDocumentCount ?? attachmentProjectionPlans.length,
		attachment_mix_score: input.attachmentRefCount ?? attachmentProjectionPlans.length,
		attachment_ref_count: input.attachmentRefCount ?? attachmentProjectionPlans.length,
		attachment_refs_key: `source/${input.noticeId}/attachment-refs.jsonl`,
		collection: "internal_notice",
		content_blocks_key: `source/${input.noticeId}/content-blocks.jsonl`,
		corpus: "campus_notices",
		document_id: `notice:example_internal_portal:${input.noticeId}`,
		embedding_model: "Qwen3-Embedding-4B",
		has_reference_only_attachment: (input.referenceOnlyCount ?? 0) > 0,
		has_spatial_attachment: (input.multimodalProcessingRequiredCount ?? 0) > 0,
		has_text_table_attachment:
			(input.textExtractableCount ?? 0) > 0 || (input.ocrRequiredCount ?? 0) > 0,
		has_unsupported_binary_attachment: false,
		multimodal_processing_required_count: input.multimodalProcessingRequiredCount ?? 0,
		notice_id: input.noticeId,
		notice_manifest_key: `source/${input.noticeId}/notice-manifest.json`,
		notice_risk_label: "body_only",
		ocr_required_count: input.ocrRequiredCount ?? 0,
		parent_snapshot: {
			attachment_projection_plans: attachmentProjectionPlans,
			notice_release_time: "2026-04-27 09:30",
			notice_title: input.title,
			notice_type_names: ["办公通知"],
		},
		planning_weight: 1,
		raw_asset_id: `asset:authenticated-notice:example_internal_portal:${input.noticeId}`,
		raw_version_id: `sha256:raw-${input.noticeId}`,
		reference_only_count: input.referenceOnlyCount ?? 0,
		revision_track: "source-faithful",
		site_id: "example_internal_portal",
		source_home_url: "https://portal.example.edu",
		text_extractable_count: input.textExtractableCount ?? 0,
		unsupported_binary_count: 0,
		version_id: `sha256:${input.noticeId}`,
	};
}

function routingSample(
	noticeId: string,
	input: {
		noticeFamily: string;
		suggestedConsumptionRoute: string;
	},
): AuthenticatedNoticeRoutingSample {
	return {
		admissionPolicy: "hold_notice_runtime",
		attachmentDocumentCount: 0,
		attachmentProcessingPolicy: "not_required",
		attachmentProcessingReason: "no_attachment_refs",
		attachmentRefCount: 0,
		machineProcessingPolicy: "not_required",
		matchedBodyPatterns: [],
		matchedTitlePatterns: ["班车"],
		multimodalProcessingRequiredCount: 0,
		noticeFamily: input.noticeFamily,
		noticeId,
		noticeTitle: "关于两校区学生通勤班车增加班次的通知",
		noticeTypeNames: ["办公通知"],
		ocrRequiredCount: 0,
		priority: 80,
		referenceOnlyCount: 0,
		suggestedConsumptionRoute: input.suggestedConsumptionRoute,
		textExtractableCount: 0,
	};
}
