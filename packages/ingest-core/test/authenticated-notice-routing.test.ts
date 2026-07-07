import { describe, expect, it } from "vitest";
import {
	classifyAuthenticatedNoticeBundleRecord,
	parseAuthenticatedNoticeNoticeFamilyConfig,
	resolveAuthenticatedNoticeRoutingSampleFromBundleRecord,
} from "../src/index.ts";

describe("authenticated notice notice-family routing", () => {
	it("classifies and routes transport status notices from injected config", () => {
		const config = parseAuthenticatedNoticeNoticeFamilyConfig({
			schema_version: "authenticated_notice_notice_family_classification_v1",
			corpus: "campus_notices",
			collection: "internal_notice",
			source_channel: "internal_portal",
			default_family: "other",
			default_admission_policy: "no_adoption",
			default_priority: 40,
			routing_policy: {
				family_policies: {
					other: {
						consumption_route: "no_adoption",
						machine_processing_policy: "skip",
					},
					transport_commute_status: {
						consumption_route: "service_status_candidate",
						machine_processing_policy: "process_multimodal",
					},
				},
				terminal_no_adoption_title_patterns: ["^讣告$"],
				default_family_route_overrides: [],
				machine_processing_value_terms: ["附件", "二维码"],
			},
			rules: [
				{
					family: "transport_commute_status",
					admission_policy: "hold_notice_runtime",
					priority: 80,
					title_any_patterns: ["班车.*(安排|调整)"],
				},
			],
		});

		const record = {
			notice_id: "355120",
			notice: {
				notice_id: "355120",
				notice_title: "关于丰台校区班车安排调整的通知",
				notice_content: "<p>班车时间调整。</p>",
				categories: [{ notice_type: "6", notice_type_name: "后勤通知" }],
			},
			notice_attachments: [{ attachment_id: "att-1" }],
		};

		expect(classifyAuthenticatedNoticeBundleRecord({ bundleRecord: record, config })).toMatchObject(
			{
				admissionPolicy: "hold_notice_runtime",
				family: "transport_commute_status",
				matchedTitlePatterns: ["班车.*(安排|调整)"],
			},
		);
		expect(
			resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({ bundleRecord: record, config }),
		).toMatchObject({
			attachmentProcessingPolicy: "metadata_only",
			machineProcessingPolicy: "not_required",
			noticeFamily: "transport_commute_status",
			noticeId: "355120",
			suggestedConsumptionRoute: "service_status_candidate",
		});
	});

	it("applies default-family route overrides before terminal no-adoption", () => {
		const config = parseAuthenticatedNoticeNoticeFamilyConfig({
			schema_version: "authenticated_notice_notice_family_classification_v1",
			corpus: "campus_notices",
			collection: "internal_notice",
			source_channel: "internal_portal",
			default_family: "other",
			default_admission_policy: "no_adoption",
			default_priority: 40,
			routing_policy: {
				family_policies: {
					other: {
						consumption_route: "no_adoption",
						machine_processing_policy: "skip",
					},
				},
				terminal_no_adoption_title_patterns: ["^讣告$"],
				default_family_route_overrides: [
					{
						name: "service_status_signal",
						consumption_route: "service_status_candidate",
						machine_processing_policy: "not_required",
						any_terms: ["暂停服务"],
					},
				],
				machine_processing_value_terms: [],
			},
			rules: [
				{
					family: "lecture_publicity",
					admission_policy: "defer",
					priority: 10,
					title_any_patterns: ["讲座"],
				},
			],
		});

		expect(
			resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
				bundleRecord: {
					notice_id: "service-stop",
					notice: {
						notice_id: "service-stop",
						notice_title: "信息门户暂停服务通知",
						notice_content: "<p>暂停服务。</p>",
					},
				},
				config,
			}),
		).toMatchObject({
			noticeFamily: "other",
			suggestedConsumptionRoute: "service_status_candidate",
		});
	});

	it("requires an attachment value signal before upgrading process_multimodal to process", () => {
		const config = parseAuthenticatedNoticeNoticeFamilyConfig({
			schema_version: "authenticated_notice_notice_family_classification_v1",
			corpus: "campus_notices",
			collection: "internal_notice",
			source_channel: "internal_portal",
			default_family: "other",
			default_admission_policy: "no_adoption",
			default_priority: 40,
			routing_policy: {
				family_policies: {
					other: {
						consumption_route: "no_adoption",
						machine_processing_policy: "skip",
					},
					transport_commute_status: {
						consumption_route: "service_status_candidate",
						machine_processing_policy: "process_multimodal",
					},
				},
				terminal_no_adoption_title_patterns: [],
				default_family_route_overrides: [],
				machine_processing_value_terms: ["附件", "图片"],
			},
			rules: [
				{
					family: "transport_commute_status",
					admission_policy: "hold_notice_runtime",
					priority: 80,
					title_any_patterns: ["班车"],
				},
			],
		});

		const baseRecord = {
			notice_id: "transport",
			notice: {
				notice_id: "transport",
				notice_title: "关于丰台校区班车调整的通知",
				notice_content: "<p>班车调整。</p>",
			},
			notice_attachments: [{ attachment_id: "att-1" }],
		};
		const attachmentRefs = [
			{
				attachment_ref_id: "attachment-0001",
				mime_type: "image/png",
				original_filename: "班车时刻表.png",
				resource_role: "attachment",
			},
		];

		expect(
			resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
				attachmentRefs,
				bundleRecord: baseRecord,
				config,
			}),
		).toMatchObject({
			attachmentProcessingPolicy: "metadata_only",
			machineProcessingPolicy: "not_required",
			multimodalProcessingRequiredCount: 1,
		});
		expect(
			resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
				attachmentRefs,
				bundleRecord: {
					...baseRecord,
					notice: {
						...baseRecord.notice,
						notice_content: "<p>班车调整，具体安排见附件图片。</p>",
					},
				},
				config,
			}),
		).toMatchObject({
			attachmentProcessingPolicy: "process",
			machineProcessingPolicy: "process",
			multimodalProcessingRequiredCount: 1,
		});
	});
});
