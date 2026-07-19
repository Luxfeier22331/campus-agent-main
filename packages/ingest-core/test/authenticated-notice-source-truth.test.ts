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

describe("authenticated notice source-truth materialization", () => {
	it("materializes notice source truth artifacts from a capture release object", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task,
		});

		expect(refs).toHaveLength(5);
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
		});
		expect(materializedManifest).not.toHaveProperty("captured_at");
		expect(materializedManifest).not.toHaveProperty("materialized_by_task_id");
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
		const task = writeCaptureRelease(objectStore);

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				outputBucket: objectStore.bucket,
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

	it("reuses identical content bytes across capture runs with different observation times", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const firstTask = writeCaptureRelease(objectStore);
		const firstRefs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task: firstTask,
		});
		const secondTask = writeCaptureRelease(objectStore, {
			captureKey:
				"internal_portal/runs/synthetic_internal_portal/20260404T015000Z/capture-release.json",
			exportedAt: "2026-04-04T01:50:00.000Z",
			runId: "run_internal_notice_20260404_second",
			taskId: "task_internal_portal_notice_capture_002",
		});

		const secondRefs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task: secondTask,
		});

		expect(secondRefs).toEqual(firstRefs);
	});

	it("fails closed when capture release points outside the input source bucket", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore, {
			bundleRef: { bucket: "other-bucket", key: bundleKey },
		});

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				outputBucket: objectStore.bucket,
				task,
			}),
		).rejects.toThrow("capture release object refs must use the source bucket");
	});

	it("fails closed when the capture bundle contains a non-object record", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord(), "bad-record"]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				outputBucket: objectStore.bucket,
				task,
			}),
		).rejects.toThrow("notices bundle record must be an object");
		expect([...objectStore.keys()].filter((key) => key.includes("/source-truth/"))).toHaveLength(0);
	});

	it("rejects an internal inline image that was not materialized", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecordWithInlineImage()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				outputBucket: objectStore.bucket,
				task,
			}),
		).rejects.toThrow(
			"authenticated notice internal attachment is not publishable: attachment-0001",
		);
		expect([...objectStore.keys()].filter((key) => key.includes("/source-truth/"))).toHaveLength(0);
	});

	it("preserves tables, merged cells, line breaks, and quotations", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleStructuredBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task,
		});
		const blocksRef = refs.find((ref) => ref.uri.endsWith("/content-blocks.jsonl"));
		const blocks = objectStore
			.getTextFromUri(requiredString(blocksRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const table = blocks.find((block) => block.block_role === "table");
		expect(table).toMatchObject({
			block_role: "table",
			table_cells: [
				[
					{ colspan: 1, header: true, rowspan: 2, text: "校区" },
					{ colspan: 2, header: true, rowspan: 1, text: "工作日" },
				],
				[
					{ colspan: 1, header: true, rowspan: 1, text: "发车" },
					{ colspan: 1, header: true, rowspan: 1, text: "到达" },
				],
				[
					{ colspan: 1, header: false, rowspan: 1, text: "海淀" },
					{ colspan: 1, header: false, rowspan: 1, text: "07:00" },
					{ colspan: 1, header: false, rowspan: 1, text: "08:10" },
				],
			],
		});
		expect(blocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ block_role: "paragraph", text_normalized: "上午 下午" }),
				expect.objectContaining({
					block_role: "blockquote",
					text_normalized: "临时班次以通知为准",
				}),
			]),
		);
		const markdownRef = refs.find((ref) => ref.uri.endsWith("/canonical/canonical.md"));
		const markdown = objectStore.getTextFromUri(requiredString(markdownRef?.uri));
		expect(markdown).toContain("| 校区 | 工作日 |");
		expect(markdown).toContain("> 临时班次以通知为准");
	});

	it("writes stable object-backed attachment references without deferred policy state", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecordWithObjectBackedAttachment()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task,
		});

		const manifestRef = refs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		const manifest = objectStore.getJsonFromUri(requiredString(manifestRef?.uri)) as Record<
			string,
			unknown
		>;
		expect(manifest).toMatchObject({
			attachment_ref_count: 1,
			notice_suggested_consumption_route: "notice_level_query",
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
			byte_size: 1024,
			content_sha256: "a".repeat(64),
			mime_type: "application/pdf",
			object_key: "internal_portal/files/schedule.pdf",
		});
		expect(attachmentRefs[0]).not.toHaveProperty("byte_fetch_required");
	});

	it.each([
		"http_404",
		"http_410",
	] as const)("publishes an explicit %s terminal attachment outcome", async (terminalReason) => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleBundleRecordWithTerminalAttachment(terminalReason)]);
		objectStore.putJson(manifestKey, sampleManifest());
		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
			task: writeCaptureRelease(objectStore),
		});
		const attachmentRefsRef = refs.find((ref) =>
			ref.uri.endsWith("/source-truth/attachment-refs.jsonl"),
		);
		expect(
			JSON.parse(objectStore.getTextFromUri(requiredString(attachmentRefsRef?.uri)).trim()),
		).toMatchObject({
			ingest_status: "terminal_unavailable",
			last_error_class: "terminal_unavailable",
			terminal_reason: terminalReason,
		});
	});

	it("rejects an internal attachment whose bytes are still missing", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleTransportBundleRecordWithMissingAttachmentFact()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		await expect(
			materializeAuthenticatedNoticeSourceTruthFromTask({
				noticeFamilyConfig: sampleNoticeFamilyConfig(),
				objectStore,
				outputBucket: objectStore.bucket,
				task,
			}),
		).rejects.toThrow(
			"authenticated notice internal attachment is not publishable: attachment-0001",
		);
	});

	it("writes owner expectations for wrapper notices without collected attachments", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson(bundleKey, [sampleWrapperBundleRecordWithoutCollectedAttachments()]);
		objectStore.putJson(manifestKey, sampleManifest());
		const task = writeCaptureRelease(objectStore);

		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
			outputBucket: objectStore.bucket,
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

	async createOrVerifyObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const existing = this.#objects.get(input.key);
		if (existing && sha256Hex(existing) !== sha256Hex(input.body)) {
			throw new Error(`object identity conflict: ${input.key}`);
		}
		this.#objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256Hex(input.body),
		};
	}

	putJson(key: string, value: unknown): Uint8Array {
		const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
		this.#objects.set(key, bytes);
		return bytes;
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

function writeCaptureRelease(
	objectStore: InMemoryObjectStore,
	input: {
		bundleRef?: Record<string, unknown>;
		captureKey?: string;
		exportedAt?: string;
		runId?: string;
		taskId?: string;
	} = {},
): IngestionTaskEnvelope {
	const key = input.captureKey ?? captureReleaseKey;
	const bytes = objectStore.putJson(key, {
		schema_version: "authenticated_notice_capture_release.v1",
		source_channel: "internal_portal",
		source_surface: "notice",
		site_id: "synthetic_internal_portal",
		capture_id: "capture:synthetic_internal_portal:notice:20260404T012345Z",
		exported_at: input.exportedAt ?? "2026-04-04T01:23:45.000Z",
		bundle_ref: input.bundleRef ?? objectStore.refFor(bundleKey, "notices_bundle"),
		export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
	});
	return {
		schema_version: "ingestion_task_envelope.v3",
		task_id: input.taskId ?? "task_internal_portal_notice_capture_001",
		run_id: input.runId ?? "run_internal_notice_20260404",
		registry_task_id: "internal_portal.notice.capture",
		input_ref: {
			byte_size: bytes.byteLength,
			kind: "object_store",
			uri: `s3://campus-agent-source/${key}`,
			digest: `sha256:${sha256Hex(bytes)}`,
		},
	};
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

function sampleStructuredBundleRecord(): Record<string, unknown> {
	const record = sampleBundleRecord();
	return {
		...record,
		notice: {
			...(record.notice as Record<string, unknown>),
			notice_content: [
				"<h1>通知标题</h1>",
				"<div><span>上午</span><br><span>下午</span></div>",
				"<table>",
				'<tr><th rowspan="2">校区</th><th colspan="2">工作日</th></tr>',
				"<tr><th>发车</th><th>到达</th></tr>",
				"<tr><td>海淀</td><td>07:00</td><td>08:10</td></tr>",
				"</table>",
				"<blockquote><p>临时班次以通知为准</p></blockquote>",
			].join(""),
		},
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
				bucket: "campus-agent-source",
				byte_size: 1024,
				final_url: "https://portal.example.edu/files/schedule.pdf",
				ingest_status: "uploaded",
				mime_type: "application/pdf",
				normalized_source_url: "https://portal.example.edu/files/schedule.pdf",
				object_key: "internal_portal/files/schedule.pdf",
				original_filename: "日程.pdf",
				origin_scope: "internal",
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
				ingest_status: "reference_only",
				mime_type: "image/png",
				original_filename: "班车时刻表.png",
				origin_scope: "internal",
				source_url: "https://portal.example.edu/files/schedule.png",
				storage_provider: "reference_only",
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

function sampleBundleRecordWithTerminalAttachment(
	terminalReason: "http_404" | "http_410",
): Record<string, unknown> {
	const record = sampleBundleRecordWithObjectBackedAttachment();
	return {
		...record,
		attachments: [
			{
				attachment_id: "att-1",
				ingest_status: "terminal_unavailable",
				last_error_class: "terminal_unavailable",
				last_http_status: terminalReason === "http_404" ? 404 : 410,
				origin_scope: "internal",
				provenance_status: "terminal_unavailable",
				source_url: "https://portal.example.edu/files/missing.pdf",
				storage_provider: "reference_only",
				terminal_reason: terminalReason,
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
