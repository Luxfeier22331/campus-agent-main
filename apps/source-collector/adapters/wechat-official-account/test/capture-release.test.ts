import { describe, expect, it, vi } from "vitest";
import { runCaptureCli } from "../src/capture-cli.ts";
import { buildWeChatOfficialAccountCaptureRelease } from "../src/capture-release.ts";
import type {
	WeChatOfficialAccountArtifactStore,
	WeChatOfficialAccountCaptureArtifactRef,
} from "../src/index.ts";

describe("WeChat official account capture release", () => {
	it("builds a run-level capture release from article source-truth artifacts", () => {
		const artifacts: WeChatOfficialAccountCaptureArtifactRef[] = [
			ref("source_truth_article_manifest", "article-manifest.json"),
			ref("source_truth_content_blocks", "content-blocks.jsonl"),
			ref("source_truth_media_refs", "media-refs.jsonl"),
			ref("provider_response", "provider/feedwe/provider-response.jsonl"),
		];

		const release = buildWeChatOfficialAccountCaptureRelease({
			accountSlug: "muc_tuanwei",
			artifacts,
			capturedAt: "2026-04-04T01:23:45.000Z",
			captureRunId: "wcrun_20260404T012345Z",
			sourceBucket: "campus-agent-source",
		});

		expect(release).toEqual({
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "wcrun_20260404T012345Z",
			captured_at: "2026-04-04T01:23:45.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "unknown",
					raw_asset_id: "unknown",
					raw_version_id: "woa_ver_abc123",
					manifest_ref: objectRef("campus-agent-source", "article-manifest.json"),
					content_blocks_ref: objectRef("campus-agent-source", "content-blocks.jsonl"),
					media_refs_ref: objectRef("campus-agent-source", "media-refs.jsonl"),
				},
			],
		});
	});

	it("writes capture release without admitting ingestion-control tasks from the collector", async () => {
		const startRun = vi.fn().mockResolvedValue({
			run: { runId: "wcrun_01JQ" },
		});
		const finalizeRun = vi.fn().mockResolvedValue({});
		const writes: Array<{ objectKey: string; text: string }> = [];
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				writes.push({
					objectKey: input.objectKey,
					text: new TextDecoder().decode(input.data),
				});
				return {
					byteSize: input.data.byteLength,
					contentSha256: "c".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const capture = vi.fn().mockResolvedValue({
			accountSlug: "muc_tuanwei",
			artifacts: [
				ref("source_truth_article_manifest", "article-manifest.json"),
				ref("source_truth_content_blocks", "content-blocks.jsonl"),
				ref("source_truth_media_refs", "media-refs.jsonl"),
			],
			planningOutcome: "complete",
			summary: {
				artifactUploads: 3,
				articlesMaterialized: 1,
				articlesSeen: 1,
				bodyCapturedArticles: 1,
				bodyMissingArticles: 0,
				failures: 0,
				mediaCaptureArtifacts: 0,
				mediaCapturedCount: 0,
				mediaCaptureFailedCount: 0,
				mediaReferenceCount: 0,
				pagesFetched: 1,
				pageCaptureArtifacts: 0,
				pageCapturesFailed: 0,
				pageCapturesSucceeded: 1,
				sourceTruthArtifacts: 3,
			},
		});
		const output: string[] = [];
		const nowValues = [
			new Date("2026-04-27T08:00:00.000Z"),
			new Date("2026-04-27T08:01:00.000Z"),
			new Date("2026-04-27T08:02:00.000Z"),
		];
		let nowIndex = 0;

		await runCaptureCli(
			["--account", "中央民族大学学生会"],
			{
				FEEDWE_EMAIL: "collector@example.com",
				FEEDWE_PASSWORD: "feedwe-live-password",
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
				WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL: "https://app-api.internal",
				WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN: "service-token",
			},
			{
				capture,
				createArtifactStore: () => artifactStore,
				createControlPlaneClient: () => ({
					finalizeRun,
					sendHeartbeat: vi.fn(),
					startRun,
				}),
				now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
				writeOutput: (value) => output.push(value),
			},
		);

		const releaseWrite = writes.find((item) => item.objectKey.endsWith("/capture-release.json"));
		expect(releaseWrite?.objectKey).toBe(
			"wechat_official_account/muc_tuanwei/runs/wcrun_01JQ/capture-release.json",
		);
		expect(releaseWrite?.text).toContain(
			'"schema_version": "wechat_official_account_capture_release.v1"',
		);
		expect(finalizeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "wcrun_01JQ",
				terminalStatus: "completed",
			}),
		);
		const parsedOutput = JSON.parse(output[0] ?? "{}") as Record<string, unknown>;
		expect(parsedOutput).toMatchObject({
			captureRunId: "wcrun_01JQ",
		});
		expect(parsedOutput).not.toHaveProperty("ingestionTask");
	});
});

function ref(
	artifactType: WeChatOfficialAccountCaptureArtifactRef["artifactType"],
	fileName: string,
): WeChatOfficialAccountCaptureArtifactRef {
	return {
		artifactType,
		byteSize: 123,
		contentSha256: "b".repeat(64),
		objectKey: `wechat_official_account/muc_tuanwei/2026/woa_ver_abc123/source-truth/${fileName}`,
		recordCount: 1,
	};
}

function objectRef(bucket: string, fileName: string) {
	return {
		bucket,
		key: `wechat_official_account/muc_tuanwei/2026/woa_ver_abc123/source-truth/${fileName}`,
		content_sha256: "b".repeat(64),
		byte_size: 123,
		record_count: 1,
	};
}
