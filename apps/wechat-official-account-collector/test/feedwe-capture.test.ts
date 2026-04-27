import { describe, expect, it, vi } from "vitest";

import {
	captureFeedWeHistory,
	normalizeWeChatAccountSlug,
	type WeChatOfficialAccountArtifactStore,
} from "../src";
import { runCaptureCli } from "../src/capture-cli.ts";
import { replayFeedWeProviderResponseSourceTruth } from "../src/replay-source-truth.ts";

describe("FeedWe capture", () => {
	it("normalizes account names into stable source-bucket asset slugs", () => {
		expect(normalizeWeChatAccountSlug("中央民族大学学生会")).toBe("中央民族大学学生会");
	});

	it("paginates FeedWe history into ADR-0002 provider and capture artifacts", async () => {
		const apiKey = "feedwe-secret-token";
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								title: "2026 春季通知",
								url: "https://mp.weixin.qq.com/s/article-a",
								publishTime: "2026-04-26T12:00:00+08:00",
							},
						],
						begin: "0",
						count: 1,
						hasMore: true,
						size: 1,
						total: 2,
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					`<!doctype html>
					<html>
					  <head>
					    <meta property="og:title" content="2026 春季通知" />
					    <meta property="og:description" content="春季通知正文第一段&#10;春季通知正文第二段" />
					    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/spring-cover/0?wx_fmt=jpeg" />
					  </head>
					  <body>
					    <h1 id="activity-name">2026 春季通知</h1>
					    <div id="js_content">
					      <section><p>春季通知正文第一段</p></section>
					      <section><p>春季通知正文第二段</p></section>
					      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/spring-inline/0?wx_fmt=jpeg" />
					    </div>
					    <script>window.ct = 1777166101;</script>
					  </body>
					</html>`,
					{
						headers: { "content-type": "text/html; charset=utf-8" },
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								title: "2026 夏季通知",
								url: "https://mp.weixin.qq.com/s/article-b",
								publishTime: "2026-04-27T12:00:00+08:00",
							},
						],
						begin: "1",
						count: 1,
						hasMore: false,
						size: 1,
						total: 2,
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					`<!doctype html>
					<html>
					  <head>
					    <meta property="og:title" content="2026 夏季通知" />
					    <meta property="og:description" content="夏季通知正文第一段&#10;夏季通知正文第二段" />
					  </head>
					  <body>
					    <h1 id="activity-name">2026 夏季通知</h1>
					    <div id="js_content">
					      <section><p>夏季通知正文第一段</p></section>
					      <section><p>夏季通知正文第二段</p></section>
					    </div>
					    <script>window.ct = 1777252501;</script>
					  </body>
					</html>`,
					{
						headers: { "content-type": "text/html; charset=utf-8" },
						status: 200,
					},
				),
			);
		const writes: Array<{ objectKey: string; text: string }> = [];
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				const text = new TextDecoder().decode(input.data);
				writes.push({ objectKey: input.objectKey, text });
				return {
					byteSize: input.data.byteLength,
					contentSha256: "d".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};

		const result = await captureFeedWeHistory({
			accountName: "中央民族大学学生会",
			artifactStore,
			fetchImplementation,
			maxArticles: 10,
			maxPages: 3,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			provider: {
				apiKey,
				baseUrl: "https://feedwe.cloud",
			},
			size: 1,
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(4);
		expect(result.summary).toEqual({
			artifactUploads: 14,
			articlesMaterialized: 2,
			articlesSeen: 2,
			failures: 0,
			pagesFetched: 2,
			pageCaptureArtifacts: 4,
			pageCapturesFailed: 0,
			pageCapturesSucceeded: 2,
			sourceTruthArtifacts: 6,
		});
		const objectKeys = writes.map((item) => item.objectKey);
		expect(objectKeys).toEqual(
			expect.arrayContaining([
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/raw_[a-f0-9]{16}\/provider\/feedwe\/provider-response\.jsonl$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/raw_[a-f0-9]{16}\/capture\/feedwe-request-summary\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/capture\/wechat-article-fetch-metadata\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/capture\/wechat-article-page\.html$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/article-manifest\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/content-blocks\.jsonl$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/中央民族大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/media-refs\.jsonl$/,
				),
			]),
		);
		expect(objectKeys).toHaveLength(14);
		expect(writes.some((item) => item.objectKey.includes("/source-truth/"))).toBe(true);
		expect(writes.some((item) => item.objectKey.endsWith("/capture/wechat-article-page.html"))).toBe(
			true,
		);
		expect(writes.some((item) => item.objectKey.includes("/projection/"))).toBe(false);
		expect(JSON.stringify(writes)).not.toContain(apiKey);
	});

	it("enforces page and article budgets before downstream processing", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								id: "article-a",
								title: "A",
								url: "https://mp.weixin.qq.com/s/article-a",
								publishTime: "2026-04-27T12:00:00+08:00",
							},
							{
								id: "article-b",
								title: "B",
								url: "https://mp.weixin.qq.com/s/article-b",
								publishTime: "2026-04-27T12:01:00+08:00",
							},
						],
						begin: "0",
						count: 2,
						hasMore: true,
						size: 2,
						total: 100,
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					`<!doctype html>
					<html>
					  <body>
					    <h1 id="activity-name">A</h1>
					    <div id="js_content"><section><p>A 正文</p></section></div>
					  </body>
					</html>`,
					{
						headers: { "content-type": "text/html; charset=utf-8" },
						status: 200,
					},
				),
			);
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				return {
					byteSize: input.data.byteLength,
					contentSha256: "e".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};

		const result = await captureFeedWeHistory({
			accountName: "中央民族大学学生会",
			artifactStore,
			fetchImplementation,
			maxArticles: 1,
			maxPages: 5,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			provider: {
				apiKey: "feedwe-secret-token",
				baseUrl: "https://feedwe.cloud",
			},
			size: 2,
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(result.planningOutcome).toBe("article_budget_exhausted");
		expect(result.summary.articlesSeen).toBe(2);
		expect(result.summary.articlesMaterialized).toBe(1);
	});

	it("replays source-truth artifacts from provider-response JSONL", async () => {
		const writes: Array<{ objectKey: string; text: string }> = [];
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				const text = new TextDecoder().decode(input.data);
				writes.push({ objectKey: input.objectKey, text });
				return {
					byteSize: input.data.byteLength,
					contentSha256: "a".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const providerResponseJsonl = `${JSON.stringify({
			articles: [
				{
					accountName: "中央民族大学学生会",
					coverUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/0?wx_fmt=jpeg",
					id: "feedwe-article-1",
					publishDate: "2026-04-27 12:00:00",
					title: "2026 春季通知",
					url: "https://mp.weixin.qq.com/s/article-a#wechat_redirect",
				},
			],
			begin: "0",
			count: 1,
			hasMore: false,
			size: 1,
			total: 1,
		})}\n`;

		const result = await replayFeedWeProviderResponseSourceTruth({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			artifactStore,
			capturedAt: "2026-04-27T08:00:00.000Z",
			providerResponseJsonl,
		});

		expect(result.summary).toEqual({
			articlesMaterialized: 1,
			sourceTruthArtifacts: 3,
		});
		expect(writes.map((item) => item.objectKey)).toEqual([
			expect.stringMatching(/\/source-truth\/article-manifest\.json$/),
			expect.stringMatching(/\/source-truth\/content-blocks\.jsonl$/),
			expect.stringMatching(/\/source-truth\/media-refs\.jsonl$/),
		]);
		expect(writes[0]?.text).toContain('"bodyState": "not_captured"');
		expect(writes[0]?.text).toContain(
			'"normalizedArticleUrl": "https://mp.weixin.qq.com/s/article-a"',
		);
	});

	it("finalizes failed app-api runs with redacted terminal errors", async () => {
		const apiKey = "feedwe-live-secret";
		const serviceToken = "collector-service-secret";
		const startRun = vi.fn().mockResolvedValue({
			run: { runId: "wcrun_01JQ" },
		});
		const finalizeRun = vi.fn().mockResolvedValue({});
		const capture = vi.fn().mockRejectedValue(
			Object.assign(new Error(`FeedWe denied token ${apiKey}`), {
				code: "provider_http_error",
			}),
		);
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				return {
					byteSize: input.data.byteLength,
					contentSha256: "f".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const nowValues = [new Date("2026-04-27T08:00:00.000Z"), new Date("2026-04-27T08:01:00.000Z")];
		let nowIndex = 0;

		await expect(
			runCaptureCli(
				["--account", "中央民族大学学生会"],
				{
					FEEDWE_API_KEY: apiKey,
					WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL: "https://app-api.internal",
					WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN: serviceToken,
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
					writeOutput: vi.fn(),
				},
			),
		).rejects.toThrow("FeedWe denied token [REDACTED]");

		expect(startRun).toHaveBeenCalledWith(
			expect.objectContaining({
				accountName: "中央民族大学学生会",
				accountSlug: "中央民族大学学生会",
				providerBaseUrl: "https://feedwe.cloud",
			}),
		);
		expect(finalizeRun).toHaveBeenCalledWith({
			artifacts: [],
			error: {
				code: "provider_http_error",
				message: "FeedWe denied token [REDACTED]",
			},
			finishedAt: "2026-04-27T08:01:00.000Z",
			runId: "wcrun_01JQ",
			summary: {
				artifactUploads: 0,
				articlesSeen: 0,
				failures: 1,
				pagesFetched: 0,
			},
			terminalStatus: "failed",
			traceId: undefined,
		});
		expect(JSON.stringify(finalizeRun.mock.calls)).not.toContain(apiKey);
		expect(JSON.stringify(finalizeRun.mock.calls)).not.toContain(serviceToken);
	});

	it("fails early when control-plane is required but not configured", async () => {
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async putObject(input) {
				return {
					byteSize: input.data.byteLength,
					contentSha256: "f".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const capture = vi.fn();

		await expect(
			runCaptureCli(
				["--account", "中央民族大学学生会", "--require-control-plane"],
				{
					FEEDWE_API_KEY: "feedwe-live-secret",
				},
				{
					capture,
					createArtifactStore: () => artifactStore,
					createControlPlaneClient: () => {
						throw new Error("control-plane client should not be created");
					},
					writeOutput: vi.fn(),
				},
			),
		).rejects.toThrow("wechat collector control plane is required");

		expect(capture).not.toHaveBeenCalled();
	});
});
