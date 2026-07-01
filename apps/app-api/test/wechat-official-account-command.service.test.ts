// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildWeChatOfficialAccountCommandService,
	type StoredWeChatOfficialAccountRun,
	type WeChatOfficialAccountCollectorPrincipal,
	type WeChatOfficialAccountCommandStore,
} from "../src/modules/wechat-official-account-command";

const collectorPrincipal: WeChatOfficialAccountCollectorPrincipal = {
	kind: "service",
	serviceClass: "wechat_official_account_collector",
	serviceId: "wechat-official-account-collector",
};

function createStoredRun(
	overrides: Partial<StoredWeChatOfficialAccountRun> = {},
): StoredWeChatOfficialAccountRun {
	return {
		accountName: "示例大学学生会",
		accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
		collectorVersion: "wechat-official-account-collector@0.1.0",
		finishedAt: null,
		lastHeartbeatAt: null,
		latestHeartbeatSequence: 0,
		provider: "feedwe",
		providerBaseUrl: "https://feedwe.cloud",
		requestSummary: {
			maxArticles: 20,
			maxPages: 2,
			pageSize: 10,
		},
		runId: "wcrun_01JQ",
		schedulerRunKey: "manual-2026-04-27T08:00:00.000Z",
		sourceChannel: "wechat_official_account",
		startFingerprintSha256: "start-fingerprint",
		startedAt: "2026-04-27T08:00:00.000Z",
		status: "accepted",
		summary: null,
		terminalErrorCode: null,
		terminalErrorMessage: null,
		terminalPayloadSha256: null,
		triggerType: "manual",
		...overrides,
	};
}

describe("wechat official-account command service", () => {
	it("accepts a FeedWe capture run and writes app-api ledger metadata", async () => {
		const store: WeChatOfficialAccountCommandStore = {
			acceptRun: vi.fn().mockResolvedValue(createStoredRun()),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunArtifacts: vi.fn(),
			getRunById: vi.fn(),
			getRunBySchedulerKey: vi.fn().mockResolvedValue(null),
			listRuns: vi.fn(),
		};
		const service = buildWeChatOfficialAccountCommandService({
			generateId: vi.fn().mockReturnValue("wcrun_01JQ"),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		const response = await service.start({
			payload: {
				accountName: "示例大学学生会",
				accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
				collectorVersion: "wechat-official-account-collector@0.1.0",
				provider: "feedwe",
				providerBaseUrl: "https://feedwe.cloud",
				requestSummary: {
					maxArticles: 20,
					maxPages: 2,
					pageSize: 10,
				},
				schedulerRunKey: "manual-2026-04-27T08:00:00.000Z",
				startedAt: "2026-04-27T08:00:00.000Z",
				triggerType: "manual",
			},
			principal: collectorPrincipal,
		});

		expect(response).toEqual({
			run: {
				accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
				provider: "feedwe",
				runId: "wcrun_01JQ",
				sourceChannel: "wechat_official_account",
				startedAt: "2026-04-27T08:00:00.000Z",
				status: "accepted",
			},
		});
		expect(store.acceptRun).toHaveBeenCalledWith({
			run: expect.objectContaining({
				accountName: "示例大学学生会",
				accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
				provider: "feedwe",
				requestSummary: {
					maxArticles: 20,
					maxPages: 2,
					pageSize: 10,
				},
				runId: "wcrun_01JQ",
				sourceChannel: "wechat_official_account",
				status: "accepted",
			}),
		});
	});

	it("finalizes only source-bucket artifact refs and rejects downstream side effects", async () => {
		const existingRun = createStoredRun({ status: "running" });
		const store: WeChatOfficialAccountCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunArtifacts: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(existingRun),
			getRunBySchedulerKey: vi.fn(),
			listRuns: vi.fn(),
		};
		const service = buildWeChatOfficialAccountCommandService({
			store,
		});

		await expect(
			service.finalize({
				payload: {
					artifacts: [
						{
							artifactType: "provider_response",
							byteSize: 42,
							contentSha256: "a".repeat(64),
							objectKey:
								"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/raw_abc/projection/notice-candidates/article.json",
							recordCount: 1,
						},
					],
					finishedAt: "2026-04-27T08:01:00.000Z",
					summary: {
						artifactUploads: 1,
						articlesSeen: 1,
						failures: 0,
						pagesFetched: 1,
					},
					terminalStatus: "completed",
				},
				principal: collectorPrincipal,
				runId: "wcrun_01JQ",
			}),
		).rejects.toMatchObject({
			code: "invalid_artifact_ref",
			status: 400,
		});
		expect(store.finalizeRun).not.toHaveBeenCalled();
	});

	it("stores artifact references and redacted terminal errors without provider bytes", async () => {
		const existingRun = createStoredRun({ status: "running" });
		const finalizedRun = createStoredRun({
			finishedAt: "2026-04-27T08:01:00.000Z",
			status: "completed_with_errors",
			summary: {
				artifactUploads: 7,
				articlesMaterialized: 1,
				articlesSeen: 1,
				failures: 1,
				pagesFetched: 1,
				pageCaptureArtifacts: 2,
				pageCapturesFailed: 0,
				pageCapturesSucceeded: 1,
				sourceTruthArtifacts: 3,
			},
			terminalErrorCode: "provider_http_error",
			terminalErrorMessage: "FeedWe request failed with token [REDACTED]",
		});
		const store: WeChatOfficialAccountCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn().mockResolvedValue(finalizedRun),
			getRunArtifacts: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(existingRun),
			getRunBySchedulerKey: vi.fn(),
			listRuns: vi.fn(),
		};
		const service = buildWeChatOfficialAccountCommandService({
			computeFinalizeFingerprint: () => "terminal-fingerprint",
			store,
		});

		const response = await service.finalize({
			payload: {
				artifacts: [
					{
						artifactType: "provider_response",
						byteSize: 512,
						contentSha256: "b".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/raw_abc/provider/feedwe/provider-response.jsonl",
						recordCount: 1,
					},
					{
						artifactType: "request_summary",
						byteSize: 256,
						contentSha256: "c".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/raw_abc/capture/feedwe-request-summary.json",
						recordCount: 1,
					},
					{
						artifactType: "page_fetch_metadata",
						byteSize: 512,
						contentSha256: "cc".repeat(32),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/capture/wechat-article-fetch-metadata.json",
						recordCount: 1,
					},
					{
						artifactType: "page_raw_html",
						byteSize: 4096,
						contentSha256: "cd".repeat(32),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/capture/wechat-article-page.html",
						recordCount: 1,
					},
					{
						artifactType: "source_truth_article_manifest",
						byteSize: 1024,
						contentSha256: "d".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/source-truth/article-manifest.json",
						recordCount: 1,
					},
					{
						artifactType: "source_truth_content_blocks",
						byteSize: 128,
						contentSha256: "e".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/source-truth/content-blocks.jsonl",
						recordCount: 1,
					},
					{
						artifactType: "source_truth_media_refs",
						byteSize: 64,
						contentSha256: "f".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/source-truth/media-refs.jsonl",
						recordCount: 1,
					},
				],
				error: {
					code: "provider_http_error",
					message: "FeedWe request failed with token [REDACTED]",
				},
				finishedAt: "2026-04-27T08:01:00.000Z",
				summary: {
					artifactUploads: 7,
					articlesMaterialized: 1,
					articlesSeen: 1,
					failures: 1,
					pagesFetched: 1,
					pageCaptureArtifacts: 2,
					pageCapturesFailed: 0,
					pageCapturesSucceeded: 1,
					sourceTruthArtifacts: 3,
				},
				terminalStatus: "completed_with_errors",
			},
			principal: collectorPrincipal,
			runId: "wcrun_01JQ",
		});

		expect(response.run.status).toBe("completed_with_errors");
		expect(store.finalizeRun).toHaveBeenCalledWith({
			artifacts: expect.arrayContaining([
				expect.objectContaining({
					artifactType: "provider_response",
					objectKey: expect.stringContaining("/provider/feedwe/provider-response.jsonl"),
				}),
				expect.objectContaining({
					artifactType: "source_truth_article_manifest",
					objectKey: expect.stringContaining("/source-truth/article-manifest.json"),
				}),
				expect.objectContaining({
					artifactType: "page_raw_html",
					objectKey: expect.stringContaining("/capture/wechat-article-page.html"),
				}),
			]),
			run: expect.objectContaining({
				terminalErrorMessage: "FeedWe request failed with token [REDACTED]",
				terminalPayloadSha256: "terminal-fingerprint",
			}),
		});
		const write = vi.mocked(store.finalizeRun).mock.calls[0]?.[0];
		expect(JSON.stringify(write)).not.toContain("2026 春季通知");
		expect(JSON.stringify(write)).not.toContain("mp.weixin.qq.com");
		expect(JSON.stringify(write)).not.toContain("providerBytes");
	});
});
