import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	createDefaultTsTaskHandlerRegistry,
	createWeChatOfficialAccountSourceTruthMaterializeHandler,
	type IngestionObjectStore,
	type IngestionTaskEnvelope,
	type IngestionTaskRegistry,
	InMemoryIngestionTaskStore,
	RustKernelRegistry,
	runRegistryTaskOnce,
} from "../src/index.ts";

const captureReleaseKey =
	"wechat_official_account/muc_tuanwei/runs/wcrun_20260404T012345Z/capture-release.json";
const manifestKey =
	"wechat_official_account/muc_tuanwei/2026/raw_01/source-truth/article-manifest.json";
const contentBlocksKey =
	"wechat_official_account/muc_tuanwei/2026/raw_01/source-truth/content-blocks.jsonl";
const mediaRefsKey =
	"wechat_official_account/muc_tuanwei/2026/raw_01/source-truth/media-refs.jsonl";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_wechat_public_notice_source_truth_materialize_001",
	run_id: "wcrun_20260404T012345Z",
	source_family: "wechat_public_notice",
	source_channel: "wechat_official_account",
	corpus: "campus_notices",
	collection: "wechat_public_notice",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-rag-source/${captureReleaseKey}`,
	},
	output_contract: "wechat_official_account_source_truth.v1",
	idempotency_key:
		"campus_notices/wechat_public_notice/source_truth_materialize/wcrun_20260404T012345Z",
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
	source_family: "wechat_public_notice",
	corpus: "campus_notices",
	collection: "wechat_public_notice",
	tasks: [
		{
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "wechat_official_account_capture_release.v1",
			output_contract: "wechat_official_account_source_truth.v1",
			can_publish_alias: false,
		},
	],
};

describe("WeChat official account source truth materialization", () => {
	it("verifies capture-release article refs and closes out release plus source-truth artifacts", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(manifestKey, {
			schemaVersion: "wechat_official_account_article_manifest.v1",
			sourceChannel: "wechat_official_account",
			accountSlug: "muc_tuanwei",
			rawAssetId: "asset:wechat:muc_tuanwei:article_01",
			rawVersionId: "raw_01",
		});
		objectStore.putText(
			contentBlocksKey,
			'{"schemaVersion":"wechat_official_account_content_block.v1","textNormalized":"正文"}\n',
		);
		objectStore.putText(mediaRefsKey, "");
		objectStore.putJson(captureReleaseKey, {
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "wcrun_20260404T012345Z",
			captured_at: "2026-04-04T01:23:45.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "article_01",
					raw_asset_id: "asset:wechat:muc_tuanwei:article_01",
					raw_version_id: "raw_01",
					manifest_ref: objectStore.refFor(manifestKey),
					content_blocks_ref: objectStore.refFor(contentBlocksKey),
					media_refs_ref: objectStore.refFor(mediaRefsKey),
				},
			],
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				wechatOfficialAccountObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			workerId: "wechat-official-account-materializer-a",
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "object_store",
				uri: `s3://campus-rag-source/${captureReleaseKey}`,
				digest: `sha256:${objectStore.sha256For(captureReleaseKey)}`,
			},
			{
				kind: "object_store",
				uri: `s3://campus-rag-source/${manifestKey}`,
				digest: `sha256:${objectStore.sha256For(manifestKey)}`,
			},
			{
				kind: "object_store",
				uri: `s3://campus-rag-source/${contentBlocksKey}`,
				digest: `sha256:${objectStore.sha256For(contentBlocksKey)}`,
			},
			{
				kind: "object_store",
				uri: `s3://campus-rag-source/${mediaRefsKey}`,
				digest: `sha256:${objectStore.sha256For(mediaRefsKey)}`,
			},
		]);
	});

	it("can be registered directly for focused runtime tests", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(manifestKey, {
			schemaVersion: "wechat_official_account_article_manifest.v1",
			sourceChannel: "wechat_official_account",
		});
		objectStore.putText(contentBlocksKey, "");
		objectStore.putText(mediaRefsKey, "");
		objectStore.putJson(captureReleaseKey, {
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "wcrun_20260404T012345Z",
			captured_at: "2026-04-04T01:23:45.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "article_01",
					raw_asset_id: "asset:wechat:muc_tuanwei:article_01",
					raw_version_id: "raw_01",
					manifest_ref: objectStore.refFor(manifestKey),
					content_blocks_ref: objectStore.refFor(contentBlocksKey),
					media_refs_ref: objectStore.refFor(mediaRefsKey),
				},
			],
		});

		const tsHandlers = createWeChatOfficialAccountSourceTruthMaterializeHandler({
			objectStore,
		});

		const result = await tsHandlers(taskRecordFromEnvelope(task), registry.tasks[0]);

		expect(result.artifactRefs).toHaveLength(4);
	});

	it("fails closed when the capture release run id does not match the task run id", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-04-04T01:25:00.000Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-rag-source");
		objectStore.putJson(captureReleaseKey, {
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "other-run",
			captured_at: "2026-04-04T01:23:45.000Z",
			article_source_truth_refs: [],
		});

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				wechatOfficialAccountObjectStore: objectStore,
			}),
			rustKernels: new RustKernelRegistry(),
			workerId: "wechat-official-account-materializer-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"WeChat capture release capture_run_id must match task run_id",
		);
	});
});

class InMemoryObjectStore implements IngestionObjectStore {
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
		throw new Error("WeChat official account source-truth materializer must not write objects");
	}

	putJson(key: string, value: unknown): void {
		this.putText(key, `${JSON.stringify(value, null, 2)}\n`);
	}

	putText(key: string, value: string): void {
		this.objects.set(key, Buffer.from(value, "utf8"));
	}

	refFor(key: string): Record<string, unknown> {
		const body = this.objects.get(key);
		if (!body) {
			throw new Error(`missing fixture object: ${key}`);
		}
		return {
			bucket: this.bucket,
			key,
			content_sha256: this.sha256For(key),
			byte_size: body.byteLength,
		};
	}

	sha256For(key: string): string {
		const body = this.objects.get(key);
		if (!body) {
			throw new Error(`missing fixture object: ${key}`);
		}
		return sha256(body);
	}
}

function taskRecordFromEnvelope(taskEnvelope: IngestionTaskEnvelope) {
	return {
		...taskEnvelope,
		attempt_count: 1,
		closeout: null,
		lease_expires_at: "2026-04-04T01:30:00.000Z",
		leased_by: "wechat-official-account-materializer-a",
		status: "running" as const,
		updated_at: "2026-04-04T01:25:00.000Z",
	};
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}
