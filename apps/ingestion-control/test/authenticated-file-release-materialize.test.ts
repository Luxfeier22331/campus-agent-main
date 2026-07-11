import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "../src/index.ts";
import { RustKernelRegistry } from "../src/task-executor";
import { createDefaultTsTaskHandlerRegistry } from "../src/ts-task-handlers";
import { runDeclaredTaskForTest } from "./test-support.ts";

const runPrefix = "internal_portal/runs/synthetic_internal_portal/20260412T003000Z";
const bundleKey = `${runPrefix}/file-releases-bundle.json`;
const manifestKey = `${runPrefix}/file-releases-manifest.json`;
const sourceFileKey =
	"internal_portal/file-release-646/2026/sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/制度-646.pdf";
const sourceFileBytes = Buffer.from("hello");
const sourceFileSha256 = sha256(sourceFileBytes);

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_file_release_source_truth_materialize_001",
	run_id: "synthetic_internal_portal:file_release:20260412T003000Z",
	source_family: "authenticated_notice",
	source_channel: "internal_portal",
	corpus: "authenticated_documents",
	collection: "file_release_source",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-agent-source/${manifestKey}`,
	},
	input_contract: "internal_portal_file_release_export_v1",
	output_contract: "authenticated_document_file_release_source_truth.v1",
	idempotency_key: "authenticated_documents/file_release_source/source_truth_materialize/run-001",
	created_by: "operator",
	created_at: "2026-04-12T00:30:00.000Z",
};

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "authenticated_notice",
	corpus: "authenticated_documents",
	collection: "file_release_source",
	tasks: [
		{
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "internal_portal_file_release_export_v1",
			output_contract: "authenticated_document_file_release_source_truth.v1",
		},
	],
};

describe("authenticated file-release source materialization", () => {
	it("materializes object-backed file-release source truth artifacts", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-12T00:30:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putBytes(sourceFileKey, sourceFileBytes);
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("completed");
		const refs = result.task?.closeout?.artifact_refs ?? [];
		expect(refs).toHaveLength(4);
		expect(refs.map((ref) => ref.uri)).toEqual(
			expect.arrayContaining([
				` s3://campus-agent-source/${manifestKey}`.trim(),
				expect.stringContaining("/source-truth/file-release-manifest.json"),
				expect.stringContaining("/source-truth/content-blocks.jsonl"),
				expect.stringContaining("/source-truth/released-file-ref.json"),
			]),
		);
		const manifestRef = refs.find((ref) => ref.uri.endsWith("/file-release-manifest.json"));
		const materialized = JSON.parse(
			objectStore.getTextFromUri(requiredString(manifestRef?.uri)),
		) as Record<string, unknown>;
		expect(materialized).toMatchObject({
			schema_version: "authenticated_notice_file_release_manifest_v1",
			source_channel: "internal_portal",
			source_surface: "file_release",
			site_id: "synthetic_internal_portal",
			file_release_id: 646,
			filename: "制度-646",
			released_file_sha256: sourceFileSha256,
			released_file_byte_size: sourceFileBytes.byteLength,
		});
	});

	it("fails closed when file-release row is reference-only", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-12T00:30:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const baseRecord = sampleBundleRecord();
		const releasedFile = baseRecord.released_file as Record<string, unknown>;
		objectStore.putJson(bundleKey, [
			{
				...baseRecord,
				released_file: {
					...releasedFile,
					storage_provider: "reference_only",
					bucket: null,
					object_key: null,
					sha256: null,
					byte_size: null,
				},
			},
		]);
		objectStore.putJson(manifestKey, sampleManifest());

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"file-release source materialization requires object_store released_file",
		);
		expect(
			[...objectStore.objects.keys()].filter((key) => key.includes("/source-truth/")),
		).toHaveLength(0);
	});

	it("fails closed when source bytes do not match the bundle checksum", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-12T00:30:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putBytes(sourceFileKey, Buffer.from("unexpected"));
		objectStore.putJson(bundleKey, [sampleBundleRecord()]);
		objectStore.putJson(manifestKey, sampleManifest());

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"file-release source bytes sha256 mismatch",
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

	putBytes(key: string, value: Uint8Array): void {
		this.objects.set(key, value);
	}

	putJson(key: string, value: unknown): void {
		this.putBytes(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
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
		file_release_id: 646,
		file_release: {
			source_surface: "file_release",
			filename: "制度-646",
			filecode: "民大校发〔2026〕646号",
			filetime: "2026-04-12 08:30",
			filedepartment: "学校办公室",
			explain_department: "教务处",
			publisher_user_name: "管理员",
			file_type_id: 1,
			file_type_name: "制度文件",
			original_portal_file_url: "/file/646.pdf",
			resolved_download_url: "https://portal.example.edu/file/646.pdf",
			upfilename: "制度-646.pdf",
			important: 0,
			det_important: 0,
			role: 0,
			last_seen_at: "2026-04-12T00:30:00.000Z",
			enrich_attempted_at: "2026-04-12T00:30:00.000Z",
		},
		released_file: {
			source_url: "https://portal.example.edu/file/646.pdf",
			normalized_source_url: "https://portal.example.edu/file/646.pdf",
			final_url: "https://portal.example.edu/file/646.pdf",
			original_filename: "制度-646.pdf",
			mime_type: "application/pdf",
			byte_size: sourceFileBytes.byteLength,
			sha256: sourceFileSha256,
			storage_provider: "object_store",
			bucket: "campus-agent-source",
			object_key: sourceFileKey,
			etag: null,
			version_id: null,
			origin_url_scheme: "https",
			origin_host: "portal.example.edu",
			origin_scope: "same_origin",
			provenance_status: "collected_internal",
			ingest_status: "uploaded",
			local_path: null,
			downloaded_at: "2026-04-12T00:30:00.000Z",
			uploaded_at: "2026-04-12T00:30:00.000Z",
			last_error: null,
			created_at: "2026-04-12T00:30:00.000Z",
			updated_at: "2026-04-12T00:30:00.000Z",
		},
	};
}

function sampleManifest(): Record<string, unknown> {
	return {
		schema_version: "internal_portal_file_release_export_v1",
		exported_at: "2026-04-12T00:30:00.000Z",
		export_date: "20260412",
		export_scope: "file-release-target-646-20260412T003000Z",
		source_channel: "internal_portal",
		source_surface: "file_release",
		site_id: "synthetic_internal_portal",
		source_home_url: "https://portal.example.edu/",
		capture_runtime: {
			runtime_shell: "source_collector_node",
			export_contract_version: "internal_portal_file_release_export_v1",
			file_release_collection_mode: "prompt_portlet_materialized",
			file_storage_mode: "object_store_write",
		},
		filters: {
			page_size: 20,
			max_pages: 1,
			max_file_releases: null,
			target_file_release_id: 646,
		},
		observed_file_types: [],
		observed_departments: [],
		observed_file_code_types: [],
		observed_explain_departments: [],
		run: {
			mode: "file_release_export",
			status: "success",
			started_at: "2026-04-12T00:30:00.000Z",
			finished_at: "2026-04-12T00:30:00.000Z",
			pages_fetched: 1,
			items_seen: 1,
			items_inserted: 1,
			detail_fetched: 1,
			file_urls_resolved: 1,
			errors: 0,
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
