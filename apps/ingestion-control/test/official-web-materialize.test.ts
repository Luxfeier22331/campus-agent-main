import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "../src/index.ts";
import { RustKernelRegistry } from "../src/task-executor";
import { createDefaultTsTaskHandlerRegistry } from "../src/ts-task-handlers";
import { runDeclaredTaskForTest } from "./test-support.ts";

const sourceTruthBundleKey = "official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json";
const pageManifestKey =
	"official_web/www_muc_edu_cn/source-assets/owasset_01/owver_01/source-truth/page-manifest.json";
const contentBlocksKey =
	"official_web/www_muc_edu_cn/source-assets/owasset_01/owver_01/source-truth/content-blocks.jsonl";
const sourceTruthBundleBody = `${JSON.stringify(sourceTruthBundleAssertion(), null, 2)}\n`;
const sourceTruthBundleDigest = sha256(Buffer.from(sourceTruthBundleBody, "utf8"));

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_official_web_stable_reference_source_truth_001",
	run_id: "owrun_01HQ",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-agent-source/${sourceTruthBundleKey}`,
		digest: `sha256:${sourceTruthBundleDigest}`,
	},
	input_contract: "official_web_source_truth_bundle.v1",
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/owrun_01HQ",
	created_by: "operator",
	created_at: "2026-03-29T08:17:33.000Z",
};

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	tasks: [
		{
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
		},
	],
};

describe("official web source truth materialization", () => {
	it("verifies source-truth bundle refs and closes out page source-truth artifacts", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(
			pageManifestKey,
			JSON.stringify({ schemaVersion: "official_web_page_manifest.v1" }),
		);
		objectStore.putText(contentBlocksKey, '{"schemaVersion":"official_web_content_block.v1"}\n');
		objectStore.putText(sourceTruthBundleKey, sourceTruthBundleBody);

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				officialWebObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "object_store",
				uri: `s3://campus-agent-source/${sourceTruthBundleKey}`,
				digest: `sha256:${objectStore.sha256For(sourceTruthBundleKey)}`,
			},
			{
				kind: "object_store",
				uri: `s3://campus-agent-source/${pageManifestKey}`,
			},
			{
				kind: "object_store",
				uri: `s3://campus-agent-source/${contentBlocksKey}`,
			},
		]);
	});

	it("fails closed when the source-truth bundle input digest is missing", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		store.admitTask({
			...task,
			input_ref: {
				kind: "object_store",
				uri: `s3://campus-agent-source/${sourceTruthBundleKey}`,
			},
		});
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(sourceTruthBundleKey, sourceTruthBundleBody);

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				officialWebObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"official web source truth bundle input_ref digest is required",
		);
	});

	it("fails closed when the source-truth bundle input digest does not match", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		store.admitTask({
			...task,
			input_ref: {
				...task.input_ref,
				digest: "sha256:bad-digest",
			},
		});
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(sourceTruthBundleKey, sourceTruthBundleBody);

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				officialWebObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"official web source truth bundle input_ref digest mismatch",
		);
	});

	it("fails closed when the source-truth bundle run id does not match", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		const mismatchedBundle = {
			...sourceTruthBundleAssertion(),
			crawlRunId: "owrun_other",
		};
		const mismatchedBundleBody = `${JSON.stringify(mismatchedBundle, null, 2)}\n`;
		store.admitTask({
			...task,
			input_ref: {
				...task.input_ref,
				digest: `sha256:${sha256(Buffer.from(mismatchedBundleBody, "utf8"))}`,
			},
		});
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(sourceTruthBundleKey, mismatchedBundleBody);

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				officialWebObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"official web source truth bundle crawlRunId must match task run_id",
		);
	});

	it("fails closed through the default registry when the official-web object store is not configured", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		store.admitTask(task);

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ts_handler_not_registered");
		expect(result.task?.closeout?.error?.message).toContain(
			"official_web/official_web/stable_reference/source_truth_materialize",
		);
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

	async putObject(): Promise<{ byteSize: number; contentSha256: string }> {
		throw new Error("official web source-truth materializer must not write objects");
	}

	putJson(key: string, value: unknown): void {
		this.putText(key, `${JSON.stringify(value, null, 2)}\n`);
	}

	putText(key: string, value: string): void {
		this.objects.set(key, Buffer.from(value, "utf8"));
	}

	sha256For(key: string): string {
		const value = this.objects.get(key);
		if (!value) {
			throw new Error(`missing object: ${key}`);
		}
		return createHash("sha256").update(value).digest("hex");
	}

	byteSizeFor(key: string): number {
		const value = this.objects.get(key);
		if (!value) {
			throw new Error(`missing object: ${key}`);
		}
		return value.byteLength;
	}
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function sourceTruthBundleAssertion(): Record<string, unknown> {
	return {
		schemaVersion: "official_web_source_truth_bundle.v1",
		sourceChannel: "official_web",
		siteId: "www_muc_edu_cn",
		crawlRunId: "owrun_01HQ",
		generatedAt: "2026-03-29T08:17:33.000Z",
		pages: [
			{
				rawAssetId: "owasset_01",
				rawVersionId: "owver_01",
				normalizedCanonicalUrl: "https://www.example.edu/admissions",
				pageFamily: "detail",
				pageManifestObjectKey: pageManifestKey,
				contentBlocksObjectKey: contentBlocksKey,
				providerExtractionObjectKey:
					"official_web/www_muc_edu_cn/source-assets/owasset_01/owver_01/provider/cheerio-basic/page-extraction.json",
				discoveredLinksObjectKey:
					"official_web/www_muc_edu_cn/source-assets/owasset_01/owver_01/provider/cheerio-basic/discovered-links.jsonl",
				responseHtmlObjectKey:
					"official_web/www_muc_edu_cn/source-assets/owasset_01/owver_01/capture/response.html",
				responseBodyHash: "hash",
				blockCount: 1,
				selectedWriteTarget: "official_web/stable_reference",
			},
		],
	};
}
