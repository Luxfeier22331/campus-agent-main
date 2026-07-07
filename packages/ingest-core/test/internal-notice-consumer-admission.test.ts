import { describe, expect, it } from "vitest";
import {
	buildInternalNoticeConsumerAdmissionManifestFromBundleRecords,
	buildInternalNoticeConsumerAdmissionManifestFromInventoryEntries,
	CONSUMER_ADMISSION_DECISION_ADMIT,
	CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
	CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
	CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH,
	CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST,
	CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
	CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION,
	CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH,
	CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
	CONSUMER_ADMISSION_POLICY_VERSION,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
	CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
	type ConsumerAdmissionDecisionRecord,
	checkInternalNoticeConsumerAdmissionGate,
	computeConsumerAdmissionSelectionSha256,
	type InternalNoticeConsumerAdmissionManifest,
	parseAuthenticatedNoticeNoticeFamilyConfig,
	parseInternalNoticeConsumerAdmissionManifestPayload,
	serializeInternalNoticeConsumerAdmissionManifest,
	validateInternalNoticeConsumerAdmissionManifest,
} from "../src/index.ts";

const NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query";
const NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE = "regulation_candidate";
const NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE = "service_status_candidate";
const NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY = "retained_for_notice_query";

describe("internal notice consumer admission manifest", () => {
	it("round-trips with stable selection hash", () => {
		const firstHash = computeConsumerAdmissionSelectionSha256(["355120", "355119"]);
		const secondHash = computeConsumerAdmissionSelectionSha256(["355119", "355120"]);
		expect(firstHash).toBe(secondHash);

		const manifest = manifestFor(["355119", "355120"], {
			decisionRecords: [
				decisionRecord("355119", {
					noticeFamily: "facility_service_status",
					suggestedConsumptionRoute: "service_status_candidate",
					targetSurface: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
					consumptionStatus: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
					admissionReasonCodes: ["service_status_candidate"],
					attachmentRefCount: 1,
				}),
				decisionRecord("355120", {
					noticeFamily: "facility_service_status",
					suggestedConsumptionRoute: "service_status_candidate",
					targetSurface: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
					consumptionStatus: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
					admissionReasonCodes: ["service_status_candidate"],
				}),
			],
			selectionSha256: firstHash,
		});

		const payload = serializeInternalNoticeConsumerAdmissionManifest(manifest);
		const loaded = parseInternalNoticeConsumerAdmissionManifestPayload(
			JSON.parse(JSON.stringify(payload)),
		);

		expect(payload.schema_version).toBe(CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION);
		expect(payload.policy_version).toBe(CONSUMER_ADMISSION_POLICY_VERSION);
		expect(loaded.selected_notice_ids).toEqual(["355119", "355120"]);
		expect(loaded.decision_records[0]?.consumption_status).toBe(
			CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
		);
		expect(payload.decision_counts[CONSUMER_ADMISSION_DECISION_ADMIT]).toBe(2);
		expect(payload.decision_counts[NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE]).toBe(2);
	});

	it("rejects duplicate decision notice IDs", () => {
		const record = decisionRecord("355119");
		const manifest = manifestFor(["355119"], {
			decisionRecords: [record, record],
		});

		expect(() => validateInternalNoticeConsumerAdmissionManifest(manifest)).toThrow(
			"duplicate decision notice_id",
		);
	});

	it("accepts regulation target surface", () => {
		expect(() =>
			validateInternalNoticeConsumerAdmissionManifest(
				manifestFor(["355119"], {
					decisionRecords: [
						decisionRecord("355119", {
							noticeFamily: "policy_regulation",
							suggestedConsumptionRoute: "regulation_candidate",
							targetSurface: NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
							consumptionStatus: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
							admissionReasonCodes: ["regulation_candidate"],
						}),
					],
				}),
			),
		).not.toThrow();
	});
});

describe("internal notice consumer admission builder", () => {
	it("maps routing samples to consumer decisions", () => {
		const manifest = buildInternalNoticeConsumerAdmissionManifestFromBundleRecords({
			admissionRunId: "consumer-admission-001",
			bundleRecords: [
				bundleRecord({
					noticeId: "course",
					noticeType: "6",
					noticeTypeName: "教学通知",
					title: "关于2025-2026学年第二学期本科生网上选课的通知",
				}),
				bundleRecord({
					noticeId: "transport",
					noticeType: "5",
					noticeTypeName: "办公通知",
					title: "关于两校区学生通勤班车增加班次的通知",
				}),
			],
			config: noticeFamilyConfig(),
			createdAt: "2026-04-27T00:00:00+00:00",
			selectionPath: "bundle.json",
			selectionSource: "bundle_dry_run",
			siteId: "example_internal_portal",
		});

		const decisions = Object.fromEntries(
			manifest.decision_records.map((record) => [record.notice_id, record]),
		);
		expect(decisions.course).toMatchObject({
			consumption_status: NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
			target_surface: NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
		});
		expect(decisions.transport).toMatchObject({
			consumption_status: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
			target_surface: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
		});
		expect(manifest.selected_notice_ids).toEqual(["course", "transport"]);
	});

	it("admits regulation candidates for typed materialization", () => {
		const manifest = buildInternalNoticeConsumerAdmissionManifestFromBundleRecords({
			admissionRunId: "consumer-admission-regulation",
			bundleRecords: [
				bundleRecord({
					noticeId: "regulation",
					noticeType: "6",
					noticeTypeName: "教学通知",
					title: "关于印发《示例大学本科生转专业实施办法（试行）》的通知",
				}),
			],
			config: noticeFamilyConfig(),
			createdAt: "2026-04-27T00:00:00+00:00",
			selectionPath: "bundle.json",
			selectionSource: "bundle_dry_run",
			siteId: "example_internal_portal",
		});

		expect(manifest.decision_records[0]).toMatchObject({
			consumption_status: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
			notice_family: "policy_regulation",
			suggested_consumption_route: "regulation_candidate",
			target_surface: NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
		});
	});

	it("keeps downstream notices as generic notice-level cards", () => {
		const manifest = buildInternalNoticeConsumerAdmissionManifestFromBundleRecords({
			admissionRunId: "consumer-admission-generic-card",
			bundleRecords: [
				bundleRecord({
					noticeId: "procurement",
					title: "示例大学海淀校区学生宿舍供电智能管理系统维保服务项目比选公告",
				}),
				bundleRecord({
					noticeId: "lecture",
					noticeType: "8",
					noticeTypeName: "科研通知",
					title: "民图一小时系列讲座 | 巧用中国知网 开启AI智能化学习研究",
				}),
				bundleRecord({
					noticeId: "activity",
					noticeType: "32",
					noticeTypeName: "学工通知",
					title: "关于举办示例大学第二十届心理文化节的通知",
				}),
			],
			config: noticeFamilyConfig(),
			createdAt: "2026-04-27T00:00:00+00:00",
			selectionPath: "bundle.json",
			selectionSource: "bundle_dry_run",
			siteId: "example_internal_portal",
		});

		const decisions = Object.fromEntries(
			manifest.decision_records.map((record) => [record.notice_id, record]),
		);
		expect(decisions.procurement?.notice_family).toBe("procurement_notice");
		for (const noticeId of ["procurement", "lecture", "activity"]) {
			expect(decisions[noticeId]).toMatchObject({
				consumption_status: NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
				suggested_consumption_route: "notice_level_query",
				target_surface: NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
			});
		}
	});

	it("preserves source-truth inventory attachment and owner counts", () => {
		const manifest = buildInternalNoticeConsumerAdmissionManifestFromInventoryEntries({
			admissionRunId: "consumer-admission-inventory",
			config: noticeFamilyConfig(),
			createdAt: "2026-04-27T00:00:00+00:00",
			inventoryEntries: [
				inventoryEntry({
					attachmentDocumentCount: 1,
					attachmentRefCount: 2,
					noticeId: "transport",
					referenceOnlyCount: 1,
					title: "关于两校区学生通勤班车增加班次的通知",
				}),
			],
			selectionPath: "inventory.jsonl",
			selectionSource: "source_truth_inventory",
		});

		expect(manifest.decision_records[0]).toMatchObject({
			attachment_document_count: 1,
			attachment_ref_count: 2,
			notice_id: "transport",
			owner_expectation_count: 2,
			reference_only_attachment_ref_count: 1,
			target_surface: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
		});
	});
});

describe("internal notice consumer admission gate", () => {
	it("blocks missing manifest", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: null,
			request: {
				operation: CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
				scopeWriteMode: "upsert_selected",
				selectedNoticeIds: ["355119"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			},
		});

		expect(report.verdict).toBe("block");
		expect(report.reasonCodes).toContain(CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST);
	});

	it("blocks ID mismatch", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: manifestFor(["355119"]),
			request: {
				operation: CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
				scopeWriteMode: "upsert_selected",
				selectedNoticeIds: ["355120"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			},
		});

		expect(report.verdict).toBe("block");
		expect(report.reasonCodes).toContain(CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH);
	});

	it("blocks non notice-level read-model surface", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: manifestFor(["355119"], {
				decisionRecords: [
					decisionRecord("355119", {
						targetSurface: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
					}),
				],
			}),
			request: {
				operation: CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
				scopeWriteMode: "upsert_selected",
				selectedNoticeIds: ["355119"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			},
		});

		expect(report.verdict).toBe("block");
		expect(report.reasonCodes).toContain(CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION);
	});

	it("blocks replace-scope without manifest authorization", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: manifestFor(["355119"]),
			request: {
				operation: CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
				scopeWriteMode: CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
				selectedNoticeIds: ["355119"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			},
		});

		expect(report.verdict).toBe("block");
		expect(report.reasonCodes).toContain(
			CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
		);
	});

	it("blocks threshold breach", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: manifestFor(["355119"], {
				decisionRecords: [decisionRecord("355119", { bodyQuality: "empty_body" })],
			}),
			request: {
				maxEmptyBodyCount: 0,
				operation: CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
				selectedNoticeIds: ["355119"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			},
		});

		expect(report.verdict).toBe("block");
		expect(report.reasonCodes).toContain(CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH);
	});

	it("allows regulation typed materialization", () => {
		const report = checkInternalNoticeConsumerAdmissionGate({
			manifest: manifestFor(["355119"], {
				decisionRecords: [
					decisionRecord("355119", {
						targetSurface: NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
					}),
				],
			}),
			request: {
				operation: CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
				selectedNoticeIds: ["355119"],
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
				targetSurface: NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
			},
		});

		expect(report.verdict).toBe("allow");
	});
});

function manifestFor(
	noticeIds: readonly string[],
	input: {
		decisionRecords?: ConsumerAdmissionDecisionRecord[];
		selectionSha256?: string;
	} = {},
): InternalNoticeConsumerAdmissionManifest {
	return {
		admission_run_id: "consumer-admission-001",
		collection: "internal_notice",
		corpus: "campus_notices",
		created_at: "2026-04-27T00:00:00+00:00",
		decision_counts: {},
		decision_records:
			input.decisionRecords ?? noticeIds.map((noticeId) => decisionRecord(noticeId)),
		policy_version: CONSUMER_ADMISSION_POLICY_VERSION,
		schema_version: CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
		scope_write_mode: "upsert_selected",
		selected_notice_ids: [...noticeIds],
		selection_path: "bundle.json",
		selection_sha256: input.selectionSha256 ?? computeConsumerAdmissionSelectionSha256(noticeIds),
		selection_source: "bundle_dry_run",
		source_channel: "internal_portal",
	};
}

function decisionRecord(
	noticeId: string,
	input: {
		admissionReasonCodes?: string[];
		attachmentRefCount?: number;
		bodyQuality?: string;
		consumptionStatus?: string;
		noticeFamily?: string;
		suggestedConsumptionRoute?: string;
		targetSurface?: string;
	} = {},
): ConsumerAdmissionDecisionRecord {
	return {
		admission_decision: CONSUMER_ADMISSION_DECISION_ADMIT,
		admission_reason_codes: input.admissionReasonCodes ?? ["notice_level_query"],
		attachment_document_count: 0,
		attachment_ref_count: input.attachmentRefCount ?? 0,
		body_quality: input.bodyQuality ?? "body_present",
		consumption_status:
			input.consumptionStatus ?? NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		notice_family: input.noticeFamily ?? "course_teaching_arrangement",
		notice_id: noticeId,
		owner_expectation_count: 0,
		pending_multimodal_attachment_count: 0,
		raw_asset_id: `asset:authenticated-notice:example_internal_portal:${noticeId}`,
		raw_version_id: `sha256:raw-${noticeId}`,
		reference_only_attachment_ref_count: 0,
		site_id: "example_internal_portal",
		source_notice_id: noticeId,
		suggested_consumption_route: input.suggestedConsumptionRoute ?? "notice_level_query",
		target_surface: input.targetSurface ?? NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
		unsupported_binary_count: 0,
	};
}

function noticeFamilyConfig() {
	return parseAuthenticatedNoticeNoticeFamilyConfig({
		collection: "internal_notice",
		corpus: "campus_notices",
		default_admission_policy: "hold_notice_runtime",
		default_family: "general_notice",
		default_priority: 10,
		routing_policy: {
			default_family_route_overrides: [
				{
					any_terms: ["讲座", "心理文化节"],
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
					name: "generic_cards",
				},
			],
			family_policies: {
				course_teaching_arrangement: {
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
				},
				facility_service_status: {
					consumption_route: "service_status_candidate",
					machine_processing_policy: "not_required",
				},
				general_notice: {
					consumption_route: "no_adoption",
					machine_processing_policy: "skip",
				},
				policy_regulation: {
					consumption_route: "regulation_candidate",
					machine_processing_policy: "not_required",
				},
				procurement_notice: {
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
				},
			},
			machine_processing_value_terms: [],
			terminal_no_adoption_title_patterns: [],
		},
		rules: [
			{
				admission_policy: "hold_notice_runtime",
				family: "policy_regulation",
				priority: 100,
				title_any_patterns: ["实施办法"],
			},
			{
				admission_policy: "hold_notice_runtime",
				family: "course_teaching_arrangement",
				notice_type_names: ["教学通知"],
				priority: 90,
				title_any_patterns: ["选课"],
			},
			{
				admission_policy: "hold_notice_runtime",
				family: "facility_service_status",
				priority: 80,
				title_any_patterns: ["班车"],
			},
			{
				admission_policy: "hold_notice_runtime",
				family: "procurement_notice",
				priority: 70,
				title_any_patterns: ["比选公告"],
			},
		],
		schema_version: "authenticated_notice_notice_family_classification_v1",
		source_channel: "internal_portal",
	});
}

function bundleRecord(input: {
	noticeId: string;
	noticeType?: string;
	noticeTypeName?: string;
	title: string;
}): Record<string, unknown> {
	return {
		notice: {
			categories:
				input.noticeType || input.noticeTypeName
					? [
							{
								notice_type: input.noticeType ?? "",
								notice_type_name: input.noticeTypeName ?? "",
							},
						]
					: [],
			notice_content: "<p>示例正文。</p>",
			notice_id: input.noticeId,
			notice_title: input.title,
		},
		notice_id: input.noticeId,
		raw_asset_id: `asset:authenticated-notice:example_internal_portal:${input.noticeId}`,
		raw_version_id: `sha256:raw-${input.noticeId}`,
	};
}

function inventoryEntry(input: {
	attachmentDocumentCount?: number;
	attachmentRefCount?: number;
	noticeId: string;
	referenceOnlyCount?: number;
	title: string;
}) {
	return {
		attachment_document_count: input.attachmentDocumentCount ?? 0,
		attachment_mix_score: input.attachmentRefCount ?? 0,
		attachment_ref_count: input.attachmentRefCount ?? 0,
		attachment_refs_key: `source/${input.noticeId}/attachment-refs.jsonl`,
		collection: "internal_notice",
		content_blocks_key: `source/${input.noticeId}/content-blocks.jsonl`,
		corpus: "campus_notices",
		document_id: `notice:example_internal_portal:${input.noticeId}`,
		embedding_model: "Qwen3-Embedding-4B",
		has_reference_only_attachment: (input.referenceOnlyCount ?? 0) > 0,
		has_spatial_attachment: false,
		has_text_table_attachment: (input.attachmentDocumentCount ?? 0) > 0,
		has_unsupported_binary_attachment: false,
		multimodal_processing_required_count: 0,
		notice_id: input.noticeId,
		notice_manifest_key: `source/${input.noticeId}/notice-manifest.json`,
		notice_risk_label: "body_with_text_attachments",
		ocr_required_count: 0,
		parent_snapshot: {
			notice_title: input.title,
			notice_type_names: ["办公通知"],
			owner_expectations: [{ owner: "transport" }, { owner: "operator" }],
		},
		planning_weight: 1,
		raw_asset_id: `asset:authenticated-notice:example_internal_portal:${input.noticeId}`,
		raw_version_id: `sha256:raw-${input.noticeId}`,
		reference_only_count: input.referenceOnlyCount ?? 0,
		revision_track: "source-faithful",
		site_id: "example_internal_portal",
		source_home_url: "https://portal.example.edu",
		text_extractable_count: input.attachmentDocumentCount ?? 0,
		unsupported_binary_count: 0,
		version_id: `sha256:${input.noticeId}`,
	};
}
