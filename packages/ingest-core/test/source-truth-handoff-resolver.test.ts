import { describe, expect, it } from "vitest";
import {
	type IngestionTaskEnvelope,
	type ObjectStore,
	resolveOfficialWebSourceTruthRefsFromTask,
	resolveWeChatOfficialAccountSourceTruthRefsFromTask,
	sha256Hex,
} from "../src/index.ts";

function pinnedRef(objectKey: string, bytes: Uint8Array) {
	return {
		byteSize: bytes.byteLength,
		contentSha256: sha256Hex(bytes),
		objectKey,
	};
}

describe("source-truth handoff resolvers", () => {
	it("verifies official web bundle refs and returns stable object-store refs", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const pageManifestBytes = objectStore.putJson("official-web/run-001/page-manifest.json", {
			schemaVersion: "official_web_page_manifest.v2",
		});
		const contentBlocksBytes = objectStore.putText(
			"official-web/run-001/content-blocks.jsonl",
			'{"text":"hello"}\n',
		);
		const pageManifestRef = pinnedRef("official-web/run-001/page-manifest.json", pageManifestBytes);
		const contentBlocksRef = pinnedRef(
			"official-web/run-001/content-blocks.jsonl",
			contentBlocksBytes,
		);
		const bundleBytes = objectStore.putJson("official-web/run-001/source-truth-bundle.json", {
			schemaVersion: "official_web_source_truth_bundle.v2",
			sourceChannel: "official_web",
			crawlRunId: "run-001",
			pages: [
				{
					pageManifestRef,
					contentBlocksRef,
					providerExtractionRef: pageManifestRef,
					discoveredLinksRef: contentBlocksRef,
					responseHtmlRef: pageManifestRef,
				},
				{
					pageManifestRef,
					contentBlocksRef,
					providerExtractionRef: pageManifestRef,
					discoveredLinksRef: contentBlocksRef,
					responseHtmlRef: pageManifestRef,
				},
			],
		});

		await expect(
			resolveOfficialWebSourceTruthRefsFromTask({
				objectStore,
				task: officialWebTask({
					byteSize: bundleBytes.byteLength,
					digest: `sha256:${sha256Hex(bundleBytes)}`,
					runId: "run-001",
				}),
			}),
		).resolves.toEqual([
			{
				byte_size: bundleBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/official-web/run-001/source-truth-bundle.json",
				digest: `sha256:${sha256Hex(bundleBytes)}`,
			},
			{
				byte_size: pageManifestBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/official-web/run-001/page-manifest.json",
				digest: `sha256:${sha256Hex(pageManifestBytes)}`,
			},
			{
				byte_size: contentBlocksBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/official-web/run-001/content-blocks.jsonl",
				digest: `sha256:${sha256Hex(contentBlocksBytes)}`,
			},
		]);
	});

	it("fails closed when official web bundle run id does not match the task", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const bundleBytes = objectStore.putJson("official-web/run-001/source-truth-bundle.json", {
			schemaVersion: "official_web_source_truth_bundle.v2",
			sourceChannel: "official_web",
			crawlRunId: "different-run",
			pages: [],
		});

		await expect(
			resolveOfficialWebSourceTruthRefsFromTask({
				objectStore,
				task: officialWebTask({
					byteSize: bundleBytes.byteLength,
					digest: `sha256:${sha256Hex(bundleBytes)}`,
					runId: "run-001",
				}),
			}),
		).rejects.toThrow("official web source truth bundle crawlRunId must match task run_id");
	});

	it("verifies WeChat article source-truth refs with required sha256", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const manifestBytes = objectStore.putJson("wechat/run-001/article-manifest.json", {
			schema_version: "wechat_official_account_article_manifest.v1",
		});
		const contentBlocksBytes = objectStore.putText("wechat/run-001/content-blocks.jsonl", "{}\n");
		const mediaRefsBytes = objectStore.putText("wechat/run-001/media-refs.jsonl", "{}\n");
		const releaseBytes = objectStore.putJson("wechat/run-001/capture-release.json", {
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "run-001",
			captured_at: "2026-07-04T00:00:00.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "article_001",
					raw_asset_id: "asset:wechat:muc_tuanwei:article_001",
					raw_version_id: "sha256:article-version",
					manifest_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/article-manifest.json",
						content_sha256: sha256Hex(manifestBytes),
					},
					content_blocks_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/content-blocks.jsonl",
						content_sha256: sha256Hex(contentBlocksBytes),
					},
					media_refs_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/media-refs.jsonl",
						content_sha256: sha256Hex(mediaRefsBytes),
					},
				},
			],
		});

		await expect(
			resolveWeChatOfficialAccountSourceTruthRefsFromTask({
				objectStore,
				task: wechatTask({
					byteSize: releaseBytes.byteLength,
					digest: `sha256:${sha256Hex(releaseBytes)}`,
					runId: "run-001",
				}),
			}),
		).resolves.toEqual([
			{
				byte_size: releaseBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/wechat/run-001/capture-release.json",
				digest: `sha256:${sha256Hex(releaseBytes)}`,
			},
			{
				byte_size: manifestBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/wechat/run-001/article-manifest.json",
				digest: `sha256:${sha256Hex(manifestBytes)}`,
			},
			{
				byte_size: contentBlocksBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/wechat/run-001/content-blocks.jsonl",
				digest: `sha256:${sha256Hex(contentBlocksBytes)}`,
			},
			{
				byte_size: mediaRefsBytes.byteLength,
				kind: "object_store",
				uri: "s3://campus-agent-source/wechat/run-001/media-refs.jsonl",
				digest: `sha256:${sha256Hex(mediaRefsBytes)}`,
			},
		]);
	});

	it("fails closed when WeChat article refs omit sha256", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putJson("wechat/run-001/article-manifest.json", {});
		objectStore.putText("wechat/run-001/content-blocks.jsonl", "{}\n");
		objectStore.putText("wechat/run-001/media-refs.jsonl", "{}\n");
		const releaseBytes = objectStore.putJson("wechat/run-001/capture-release.json", {
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "run-001",
			captured_at: "2026-07-04T00:00:00.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "article_001",
					raw_asset_id: "asset:wechat:muc_tuanwei:article_001",
					raw_version_id: "sha256:article-version",
					manifest_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/article-manifest.json",
					},
					content_blocks_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/content-blocks.jsonl",
					},
					media_refs_ref: {
						bucket: "campus-agent-source",
						key: "wechat/run-001/media-refs.jsonl",
					},
				},
			],
		});

		await expect(
			resolveWeChatOfficialAccountSourceTruthRefsFromTask({
				objectStore,
				task: wechatTask({
					byteSize: releaseBytes.byteLength,
					digest: `sha256:${sha256Hex(releaseBytes)}`,
					runId: "run-001",
				}),
			}),
		).rejects.toThrow("WeChat manifest_ref content_sha256 is required");
	});
});

function officialWebTask(input: {
	byteSize: number;
	digest: string;
	runId: string;
}): IngestionTaskEnvelope {
	return {
		schema_version: "ingestion_task_envelope.v3",
		task_id: `task-official-web-${input.runId}`,
		run_id: input.runId,
		registry_task_id: "official_web.capture",
		input_ref: {
			byte_size: input.byteSize,
			kind: "object_store",
			uri: "s3://campus-agent-source/official-web/run-001/source-truth-bundle.json",
			digest: input.digest,
		},
	};
}

function wechatTask(input: {
	byteSize: number;
	digest: string;
	runId: string;
}): IngestionTaskEnvelope {
	return {
		schema_version: "ingestion_task_envelope.v3",
		task_id: `task-wechat-${input.runId}`,
		run_id: input.runId,
		registry_task_id: "wechat_official_account.capture",
		input_ref: {
			byte_size: input.byteSize,
			kind: "object_store",
			uri: "s3://campus-agent-source/wechat/run-001/capture-release.json",
			digest: input.digest,
		},
	};
}

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
		this.#objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256Hex(input.body),
		};
	}

	putJson(key: string, value: unknown): Uint8Array {
		return this.putText(key, JSON.stringify(value));
	}

	putText(key: string, value: string): Uint8Array {
		const bytes = new TextEncoder().encode(value);
		this.#objects.set(key, bytes);
		return bytes;
	}
}
