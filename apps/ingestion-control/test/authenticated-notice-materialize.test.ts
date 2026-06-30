import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	createAuthenticatedNoticeTsTaskHandlerRegistry,
	createDefaultTsTaskHandlerRegistry,
	type IngestionTaskEnvelope,
	type IngestionTaskRegistry,
	InMemoryIngestionTaskStore,
	RustKernelRegistry,
	runRegistryTaskOnce,
} from "../src/index.ts";

const captureReleaseKey =
	"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/capture-release.json";
const bundleKey =
	"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/notices-bundle.json";
const manifestKey =
	"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/export-manifest.json";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_internal_notice_source_truth_materialize_001",
	run_id: "run_internal_notice_20260404",
	source_family: "authenticated_notice",
	source_channel: "authenticated_notice_portal",
	corpus: "campus_notices",
	collection: "internal_notice",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-rag-source/${captureReleaseKey}`,
	},
	output_contract: "authenticated_notice_source_truth.v1",
	idempotency_key: "campus_notices/internal_notice/source_truth_materialize/run-001",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 1,
	},
	created_by: "operator",
	created_at: "2026-04-04T01:25:00.000Z",
};

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v1",
	source_family: "authenticated_notice",
	corpus: "campus_notices",
	collection: "internal_notice",
	tasks: [
		{
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "authenticated_notice_capture_release.v1",
			output_contract: "authenticated_notice_source_truth.v1",
			can_publish_alias: false,
		},
	],
};

describe("authenticated notice source truth materialization", () => {
	it("materializes notice source truth artifacts from a capture release object", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		const bundleRecords = [sampleBundleRecord()];
		const manifest = sampleManifest();
		objectStore.putJson(bundleKey, bundleRecords);
		objectStore.putJson(manifestKey, manifest);
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "authenticated_notice_portal",
			source_surface: "notice",
			site_id: "muc_internal_portal",
			capture_id: "capture:muc_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createAuthenticatedNoticeTsTaskHandlerRegistry({ objectStore }),
			rustKernels: new RustKernelRegistry(),
			workerId: "authenticated-notice-materializer-a",
		});

		expect(result.status).toBe("completed");
		const artifactRefs = result.task?.closeout?.artifact_refs ?? [];
		expect(artifactRefs).toHaveLength(3);
		expect(artifactRefs.every((ref) => ref.kind === "object_store")).toBe(true);
		const manifestRef = artifactRefs.find((ref) => ref.uri.endsWith("/notice-manifest.json"));
		expect(manifestRef?.uri).toContain("s3://campus-rag-source/authenticated_notice_portal/");
		const materializedManifest = JSON.parse(
			objectStore.getTextFromUri(requiredString(manifestRef?.uri)),
		) as Record<string, unknown>;
		expect(materializedManifest).toMatchObject({
			schema_version: "authenticated_notice_manifest_v1",
			source_channel: "authenticated_notice_portal",
			site_id: "muc_internal_portal",
			notice_id: "355119",
			notice_title_normalized: "通知标题",
		});
		const contentBlocksRef = artifactRefs.find((ref) => ref.uri.endsWith("/content-blocks.jsonl"));
		const contentBlocks = objectStore
			.getTextFromUri(requiredString(contentBlocksRef?.uri))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(contentBlocks.map((block) => block.text_normalized)).toContain("通知正文 & 报名");
	});

	it("uses the authenticated notice materializer through the default TS handler registry", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "authenticated_notice_portal",
			source_surface: "notice",
			site_id: "muc_internal_portal",
			capture_id: "capture:muc_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			workerId: "default-registry-materializer-a",
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toHaveLength(3);
		expect(result.task?.closeout?.artifact_refs.every((ref) => ref.kind === "object_store")).toBe(
			true,
		);
	});

	it("fails closed through the default registry when the notice object store is not configured", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "default-registry-materializer-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ts_handler_not_registered");
		expect(result.task?.closeout?.error?.message).toContain(
			"authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
		);
	});

	it("fails closed when capture release points outside the input source bucket", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "authenticated_notice_portal",
			source_surface: "notice",
			site_id: "muc_internal_portal",
			capture_id: "capture:muc_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: { bucket: "other-bucket", key: bundleKey },
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createAuthenticatedNoticeTsTaskHandlerRegistry({ objectStore }),
			rustKernels: new RustKernelRegistry(),
			workerId: "authenticated-notice-materializer-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("task_executor_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"capture release object refs must use the source bucket",
		);
	});

	it("fails closed when the capture bundle contains a non-object record", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(bundleKey, [sampleBundleRecord(), "bad-record"]);
		objectStore.putJson(manifestKey, sampleManifest());
		objectStore.putJson(captureReleaseKey, {
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "authenticated_notice_portal",
			source_surface: "notice",
			site_id: "muc_internal_portal",
			capture_id: "capture:muc_internal_portal:notice:20260404T012345Z",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: objectStore.refFor(bundleKey, "notices_bundle"),
			export_manifest_ref: objectStore.refFor(manifestKey, "export_manifest"),
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createAuthenticatedNoticeTsTaskHandlerRegistry({ objectStore }),
			rustKernels: new RustKernelRegistry(),
			workerId: "authenticated-notice-materializer-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"notices bundle record must be an object",
		);
		expect(
			[...objectStore.objects.keys()].filter((key) => key.includes("/source-truth/")),
		).toHaveLength(0);
	});
});

class InMemoryObjectStore {
	readonly bucket: string;
	readonly objects = new Map<string, Uint8Array>();

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const value = this.objects.get(input.key);
		if (!value) {
			throw new Error(`missing object: ${input.key}`);
		}
		return value;
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
		this.objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256(input.body),
		};
	}

	putJson(key: string, value: unknown): void {
		this.objects.set(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
	}

	refFor(key: string, role: string): Record<string, unknown> {
		const body = this.objects.get(key);
		if (!body) {
			throw new Error(`missing fixture object: ${key}`);
		}
		return {
			role,
			bucket: this.bucket,
			key,
			content_sha256: sha256(body),
			byte_size: body.byteLength,
		};
	}

	getTextFromUri(uri: string): string {
		const prefix = `s3://${this.bucket}/`;
		if (!uri.startsWith(prefix)) {
			throw new Error(`unexpected uri: ${uri}`);
		}
		const body = this.objects.get(uri.slice(prefix.length));
		if (!body) {
			throw new Error(`missing uri object: ${uri}`);
		}
		return Buffer.from(body).toString("utf8");
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

function sampleManifest(): Record<string, unknown> {
	return {
		schema_version: "authenticated_notice_collector_export_v2",
		exported_at: "2026-04-04T01:23:45.000Z",
		source_channel: "authenticated_notice_portal",
		source_surface: "notice",
		site_id: "muc_internal_portal",
		source_home_url: "https://portal.example.edu",
		collector: {
			runtime_shell: "repo_local_node",
			export_contract_version: "authenticated_notice_collector_export_v2",
		},
	};
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function requiredString(value: string | undefined): string {
	if (!value) {
		throw new Error("expected string");
	}
	return value;
}
