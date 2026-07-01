import { describe, expect, it, vi } from "vitest";
import { runCaptureCli } from "../src/capture-cli.ts";
import type {
	WeChatOfficialAccountArtifactStore,
	WeChatOfficialAccountCaptureArtifactRef,
} from "../src/index.ts";
import {
	buildWeChatOfficialAccountCaptureRelease,
	buildWeChatOfficialAccountSourceTruthTask,
	createWeChatOfficialAccountIngestionControlClient,
} from "../src/ingestion-control.ts";

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

	it("builds the ingestion-control task envelope for the capture release", () => {
		const task = buildWeChatOfficialAccountSourceTruthTask({
			captureReleaseContentSha256: "a".repeat(64),
			captureReleaseKey:
				"wechat_official_account/muc_tuanwei/runs/wcrun_20260404T012345Z/capture-release.json",
			captureRunId: "wcrun_20260404T012345Z",
			createdAt: "2026-04-04T01:25:00.000Z",
			sourceBucket: "campus-agent-source",
		});

		expect(task).toMatchObject({
			schema_version: "ingestion_task_envelope.v1",
			task_id: "task_wechat_public_notice_source_truth_wcrun_20260404T012345Z",
			run_id: "wcrun_20260404T012345Z",
			source_family: "wechat_public_notice",
			source_channel: "wechat_official_account",
			corpus: "campus_notices",
			collection: "wechat_public_notice",
			task_kind: "source_truth_materialize",
			input_ref: {
				kind: "object_store",
				uri: "s3://campus-agent-source/wechat_official_account/muc_tuanwei/runs/wcrun_20260404T012345Z/capture-release.json",
				digest: `sha256:${"a".repeat(64)}`,
			},
			output_contract: "wechat_official_account_source_truth.v1",
			created_by: "wechat-official-account-collector",
		});
	});

	it("admits tasks directly through ingestion-control", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify({ task_id: "task-1", status: "queued" }), {
					status: 200,
				}),
		);
		const client = createWeChatOfficialAccountIngestionControlClient({
			baseUrl: "https://ingestion-control.internal",
			fetchImplementation,
		});
		const task = buildWeChatOfficialAccountSourceTruthTask({
			captureReleaseContentSha256: "a".repeat(64),
			captureReleaseKey: "wechat_official_account/muc_tuanwei/runs/run-1/capture-release.json",
			captureRunId: "run-1",
			createdAt: "2026-04-04T01:25:00.000Z",
			sourceBucket: "campus-agent-source",
		});

		await expect(client.admitTask(task)).resolves.toEqual({
			status: "queued",
			task_id: "task-1",
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://ingestion-control.internal/internal/ingestion/tasks",
			expect.objectContaining({
				body: JSON.stringify(task),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
	});

	it("writes capture release and admits ingestion-control tasks after successful app-api run finalization", async () => {
		const startRun = vi.fn().mockResolvedValue({
			run: { runId: "wcrun_01JQ" },
		});
		const finalizeRun = vi.fn().mockResolvedValue({});
		const admitTask = vi.fn().mockResolvedValue({
			task_id: "task_wechat_public_notice_source_truth_wcrun_01JQ",
			status: "queued",
		});
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
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
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
				createIngestionControlClient: () => ({ admitTask }),
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
		expect(admitTask).toHaveBeenCalledWith(
			expect.objectContaining({
				input_ref: {
					kind: "object_store",
					uri: "s3://campus-agent-source/wechat_official_account/muc_tuanwei/runs/wcrun_01JQ/capture-release.json",
					digest: `sha256:${"c".repeat(64)}`,
				},
				run_id: "wcrun_01JQ",
			}),
		);
		const parsedOutput = JSON.parse(output[0] ?? "{}") as Record<string, unknown>;
		expect(parsedOutput).toMatchObject({
			captureRunId: "wcrun_01JQ",
			ingestionTask: {
				status: "queued",
				task_id: "task_wechat_public_notice_source_truth_wcrun_01JQ",
			},
		});
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
