import { describe, expect, it } from "vitest";
import {
	type IngestionTaskEnvelope,
	materializeAuthenticatedNoticeSourceTruthFromTask,
	type ObjectStore,
	parseAuthenticatedNoticeNoticeFamilyConfig,
	sha256Hex,
} from "../src/index.ts";

const captureReleaseKey =
	"internal_portal/runs/synthetic_internal_portal/20260404T012345Z/capture-release.json";
const bundleKey =
	"internal_portal/runs/synthetic_internal_portal/20260404T012345Z/notices-bundle.json";
const manifestKey =
	"internal_portal/runs/synthetic_internal_portal/20260404T012345Z/export-manifest.json";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_internal_notice_source_truth_materialize_001",
	run_id: "run_internal_notice_20260404",
	source_family: "authenticated_notice",
	source_channel: "internal_portal",
	corpus: "campus_notices",
	collection: "internal_notice",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-agent-source/${captureReleaseKey}`,
	},
	input_contract: "authenticated_notice_capture_release.v1",
	output_contract: "authenticated_notice_source_truth.v1",
	idempotency_key: "campus_notices/internal_notice/source_truth_materialize/run-001",
	created_by: "operator",
	created_at: "2026-04-04T01:25:00.000Z",
};

describe("authenticated notice source-truth materialization", () => {
	it("materializes notice source truth artifacts from a capture release object", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			task,
		});

		expect(refs).toHaveLength(11);
		expect(refs.every((ref) => ref.kind === "object_store")).toBe(true);
		const manifestRef = refs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		expect(manifestRef?.uri).toContain("s3://campus-agent-source/internal_portal/");
		const materializedManifest = objectStore.getJsonFromUri(requiredString(manifestRef?.uri));
		expect(materializedManifest).toMatchObject({
			schema_version: "authenticated_notice_manifest_v1",
			source_channel: "internal_portal",
			site_id: "synthetic_internal_portal",
			notice_id: "355119",
			notice_title_normalized: "通知标题",
			materialized_by_task_id: task.task_id,
		});
		const contentBlocksRef = refs.find((ref) => ref.uri.endsWith("/content-blocks.jsonl"));
		const contentBlocks = objectStore
			.getTextFromUri(requiredString(contentBlocksRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(contentBlocks.map((block) => block.text_normalized)).toContain("通知正文 & 报名");
	});

	it("fails closed when task input_ref digest mismatches the capture release bytes", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				task: {
					...task,
					input_ref: {
						...task.input_ref,
						digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
					},
				},
			}),
		).rejects.toThrow("authenticated notice capture release input_ref digest mismatch");
	});

	it("fails closed when capture release points outside the input source bucket", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: { bucket: "other-bucket", key: bundleKey },
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				task,
			}),
		).rejects.toThrow("capture release object refs must use the source bucket");
	});

	it("fails closed when the capture bundle contains a non-object record", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord(), "bad-record"]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				task,
			}),
		).rejects.toThrow("notices bundle record must be an object");
		expect([...objectStore.keys()].filter((key) => key.includes("/source-truth/"))).toHaveLength(0);
	});

	it("materializes canonical notice document artifacts and inline image references", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecordWithInlineImage()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			task,
		});

		expect(refs.map((ref) => ref.uri)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("/capture/list-response.json"),
				expect.stringContaining("/provider/normalized-notice.json"),
				expect.stringContaining("/source-truth/attachment-refs.jsonl"),
				expect.stringContaining("/canonical/canonical.md"),
				expect.stringContaining("/canonical/document-units.jsonl"),
			]),
		);
		const attachmentRefsRef = refs.find((ref) =>
			ref.uri.endsWith("/source-truth/attachment-refs.jsonl"),
		);
		const attachmentRefs = objectStore
			.getTextFromUri(requiredString(attachmentRefsRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(attachmentRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relation_source: "notice_html_inline_img",
					resource_role: "inline_image",
					content_kind: "inline_image",
					ingest_status: "reference_only",
					source_url: "http://portal.example.edu/files/schedule.png",
					normalized_source_url: "https://portal.example.edu/files/schedule.png",
				}),
			]),
		);
		const canonicalRef = refs.find((ref) => ref.uri.endsWith("/canonical/canonical.md"));
		expect(objectStore.getTextFromUri(requiredString(canonicalRef?.uri))).toContain(
			"# 关于发布《班车安排》的通知",
		);
		const unitsRef = refs.find((ref) => ref.uri.endsWith("/canonical/document-units.jsonl"));
		const units = objectStore
			.getTextFromUri(requiredString(unitsRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(units[0]).toMatchObject({
			doc_id: "notice:synthetic_internal_portal:355120",
			unit_type: "heading",
			text: "关于发布《班车安排》的通知",
		});
	});

	it("writes source retention policy fields into notice manifest and attachment refs", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecordWithObjectBackedAttachment()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			task,
		});

		const manifestRef = refs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		const manifest = objectStore.getJsonFromUri(requiredString(manifestRef?.uri)) as Record<
			string,
			unknown
		>;
		expect(manifest).toMatchObject({
			admitted_source_byte_ref_count: 0,
			attachment_capture_policy_counts: { metadata_only: 1 },
			attachment_capture_state_counts: { metadata_recorded: 1 },
			metadata_only_attachment_ref_count: 1,
			notice_capture_route: "notice_level_query_only",
			notice_suggested_consumption_route: "notice_level_query",
			quarantine_attachment_ref_count: 0,
			required_source_object_count: 0,
			retention_class_counts: { metadata_only: 1 },
		});
		const attachmentRefsRef = refs.find((ref) =>
			ref.uri.endsWith("/source-truth/attachment-refs.jsonl"),
		);
		const attachmentRefs = objectStore
			.getTextFromUri(requiredString(attachmentRefsRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(attachmentRefs[0]).toMatchObject({
			attachment_capture_policy: "metadata_only",
			attachment_capture_state: "metadata_recorded",
			attachment_promotion_state: "not_applicable",
			byte_fetch_required: false,
			notice_capture_route: "notice_level_query_only",
			required_source_object: false,
			retention_class: "metadata_only",
		});
	});

	it("uses notice-family routing config before attachment retention", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleTransportBundleRecordWithMissingAttachmentFact()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			task,
		});

		const manifestRef = refs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		const manifest = objectStore.getJsonFromUri(requiredString(manifestRef?.uri)) as Record<
			string,
			unknown
		>;
		expect(manifest).toMatchObject({
			attachment_capture_policy_counts: { fetch_to_quarantine: 1 },
			notice_capture_route: "candidate_service_fact",
			notice_family: "transport_commute_status",
			notice_suggested_consumption_route: "service_status_candidate",
			quarantine_attachment_ref_count: 1,
		});
		const attachmentRefsRef = refs.find((ref) =>
			ref.uri.endsWith("/source-truth/attachment-refs.jsonl"),
		);
		const attachmentRefs = objectStore
			.getTextFromUri(requiredString(attachmentRefsRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(attachmentRefs[0]).toMatchObject({
			attachment_capture_policy: "fetch_to_quarantine",
			attachment_capture_state: "not_attempted",
			byte_fetch_required: true,
			notice_capture_route: "candidate_service_fact",
			retention_class: "quarantine_candidate",
		});
	});

	it("writes owner expectations for wrapper notices without collected attachments", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleWrapperBundleRecordWithoutCollectedAttachments()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			task,
		});

		const manifestRef = refs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		const manifest = objectStore.getJsonFromUri(requiredString(manifestRef?.uri)) as Record<
			string,
			unknown
		>;
		expect(manifest).toMatchObject({
			owner_expectation_count: 2,
			owner_expectations: [
				{
					evidence_reason: "attachment_anchor_detected",
					evidence_text: "附件：《学生人工智能使用管理办法》",
					owner_kind: "attachment_document",
					owner_title_hint: "学生人工智能使用管理办法",
					relation_type: "attachment_ref",
				},
				{
					evidence_reason: "file_release_reference_detected",
					evidence_text: "请登录信息门户-文件发布自行下载参照执行。",
					owner_kind: "file_release_document",
					owner_title_hint: "学生人工智能使用管理办法",
					relation_type: "file_release_ref",
				},
			],
		});
	});
});

class InMemoryObjectStore implements ObjectStore {
	readonly #objects = new Map<string, Uint8Array>();
	readonly bucket: string;

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const object = this.#objects.get(input.key);
		if (!object) {
			throw new Error(`missing object: ${input.key}`);
		}
		return object;
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		this.#objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256Hex(input.body),
		};
	}

	putJson(key: string, value: unknown): void {
		this.#objects.set(key, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
	}

	refFor(key: string, role: string): Record<string, unknown> {
		const body = this.#objects.get(key);
		if (!body) {
			throw new Error(`missing assertion object: ${key}`);
		}
		return {
			role,
			bucket: this.bucket,
			key,
			content_sha256: sha256Hex(body),
			byte_size: body.byteLength,
		};
	}

	getJsonFromUri(uri: string): unknown {
		return JSON.parse(this.getTextFromUri(uri)) as unknown;
	}

	getTextFromUri(uri: string): string {
		const prefix = `s3://${this.bucket}/`;
		if (!uri.startsWith(prefix)) {
			throw new Error(`unexpected uri: ${uri}`);
		}
		const body = this.#objects.get(uri.slice(prefix.length));
		if (!body) {
			throw new Error(`missing uri object: ${uri}`);
		}
		return new TextDecoder().decode(body);
	}

	keys(): IterableIterator<string> {
		return this.#objects.keys();
	}
}

function sampleBundleRecord(): Record<string, unknown> {
	return {
		notice_id: 355119,
		notice: {
			notice_id: 355119,
			notice_title: "通知标题",
			organization_name: "教务处",
			organization_id: "00001",
			notice_release_time: "2026-04-02 18:49",
			notice_create_time: "2026-04-02 18:40",
			notice_first_time: "2026-04-02 18:40",
			notice_content: "<h1>通知标题</h1><p>通知正文 &amp; <strong>报名</strong></p>",
			notice_link: "https://portal.example.edu/notice/355119",
			notice_source: 1,
			notice_link_state: 0,
			notice_state: 1,
			notice_stick: 0,
			categories: [
				{
					notice_id: 355119,
					notice_type: "6",
					notice_type_name: "教学通知",
				},
			],
		},
		links: [],
		notice_attachments: [],
		attachments: [],
	};
}

function sampleBundleRecordWithInlineImage(): Record<string, unknown> {
	return {
		notice_id: 355120,
		notice: {
			notice_id: 355120,
			notice_title: "关于发布《班车安排》的通知",
			organization_name: "后勤保障处",
			organization_id: "00002",
			notice_release_time: "2026-04-03 08:30",
			notice_create_time: "2026-04-03 08:00",
			notice_first_time: "2026-04-03 08:00",
			notice_content:
				'<h1>关于发布《班车安排》的通知</h1><p>班车安排见下图。</p><img src="http://portal.example.edu/files/schedule.png" alt="班车时刻表">',
			notice_link: "https://portal.example.edu/notice/355120",
			notice_source: 1,
			notice_link_state: 0,
			notice_state: 1,
			notice_stick: 0,
			categories: [
				{
					notice_id: 355120,
					notice_type: "9",
					notice_type_name: "后勤通知",
				},
			],
		},
		links: [],
		notice_attachments: [],
		attachments: [],
	};
}

function sampleBundleRecordWithObjectBackedAttachment(): Record<string, unknown> {
	const record = sampleBundleRecord();
	return {
		...record,
		notice_attachments: [
			{
				attachment_id: "att-1",
				anchor_text: "附件：日程.pdf",
				link_id: "link-1",
				relation_source: "notice_attachment",
				resource_role: "attachment",
			},
		],
		attachments: [
			{
				attachment_id: "att-1",
				byte_size: 1024,
				final_url: "https://portal.example.edu/files/schedule.pdf",
				ingest_status: "uploaded",
				mime_type: "application/pdf",
				normalized_source_url: "https://portal.example.edu/files/schedule.pdf",
				object_key: "internal_portal/files/schedule.pdf",
				original_filename: "日程.pdf",
				origin_scope: "same_origin",
				sha256: "a".repeat(64),
				source_url: "https://portal.example.edu/files/schedule.pdf",
				storage_provider: "object_store",
			},
		],
		links: [
			{
				content_kind: "document",
				final_url: "https://portal.example.edu/files/schedule.pdf",
				id: "link-1",
				link_text: "附件：日程.pdf",
				url: "https://portal.example.edu/files/schedule.pdf",
			},
		],
	};
}

function sampleTransportBundleRecordWithMissingAttachmentFact(): Record<string, unknown> {
	return {
		notice_id: 355121,
		notice: {
			notice_id: 355121,
			notice_title: "关于丰台校区班车安排调整的通知",
			organization_name: "后勤保障处",
			notice_release_time: "2026-04-03 08:30",
			notice_content: "<p>班车安排如下，具体班次见附件图片。</p>",
			notice_link: "https://portal.example.edu/notice/355121",
			categories: [
				{
					notice_id: 355121,
					notice_type: "9",
					notice_type_name: "后勤通知",
				},
			],
		},
		notice_attachments: [
			{
				attachment_id: "att-1",
				anchor_text: "附件：班车时刻表.png",
				link_id: "link-1",
				relation_source: "notice_attachment",
				resource_role: "attachment",
			},
		],
		attachments: [
			{
				attachment_id: "att-1",
				mime_type: "image/png",
				original_filename: "班车时刻表.png",
				source_url: "https://portal.example.edu/files/schedule.png",
			},
		],
		links: [
			{
				content_kind: "inline_image",
				id: "link-1",
				link_text: "附件：班车时刻表.png",
				url: "https://portal.example.edu/files/schedule.png",
			},
		],
	};
}

function sampleWrapperBundleRecordWithoutCollectedAttachments(): Record<string, unknown> {
	return {
		notice_id: 355122,
		notice: {
			notice_id: 355122,
			notice_title: "关于发布《学生人工智能使用管理办法》的通知",
			organization_name: "教务处",
			notice_release_time: "2026-04-03 08:30",
			notice_content:
				"<p>现将《学生人工智能使用管理办法》予以发布。</p><p>附件：《学生人工智能使用管理办法》</p><p>请登录信息门户-文件发布自行下载参照执行。</p>",
			notice_link: "https://portal.example.edu/notice/355122",
			categories: [
				{
					notice_id: 355122,
					notice_type: "6",
					notice_type_name: "教学通知",
				},
			],
		},
		links: [],
		notice_attachments: [],
		attachments: [],
	};
}

function sampleManifest(): Record<string, unknown> {
	return {
		schema_version: "internal_portal_notice_export_v1",
		exported_at: "2026-04-04T01:23:45.000Z",
		source_channel: "internal_portal",
		source_surface: "notice",
		site_id: "synthetic_internal_portal",
		source_home_url: "https://portal.example.edu",
		capture_runtime: {
			runtime_shell: "source_collector_node",
			export_contract_version: "internal_portal_notice_export_v1",
		},
	};
}

function requiredString(value: string | undefined): string {
	if (!value) {
		throw new Error("expected string");
	}
	return value;
}

function sampleNoticeFamilyConfig() {
	return parseAuthenticatedNoticeNoticeFamilyConfig({
		schema_version: "authenticated_notice_notice_family_classification_v1",
		corpus: "campus_notices",
		collection: "internal_notice",
		source_channel: "internal_portal",
		default_family: "other",
		default_admission_policy: "no_adoption",
		default_priority: 40,
		routing_policy: {
			family_policies: {
				course_teaching_arrangement: {
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
				},
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
			default_family_route_overrides: [
				{
					name: "notice_level_action_signal",
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
					any_terms: ["报名"],
				},
			],
			machine_processing_value_terms: ["附件", "二维码"],
		},
		rules: [
			{
				family: "transport_commute_status",
				admission_policy: "hold_notice_runtime",
				priority: 80,
				title_any_patterns: ["班车.*(安排|调整)"],
			},
			{
				family: "course_teaching_arrangement",
				admission_policy: "hold_notice_runtime",
				priority: 20,
				notice_type_names: ["教学通知"],
			},
		],
	});
}
