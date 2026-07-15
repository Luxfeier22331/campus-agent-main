import { describe, expect, it, vi } from "vitest";
import {
	captureFeedWeHistory,
	normalizeWeChatAccountSlug,
	type WeChatOfficialAccountArtifactStore,
} from "../src/index.ts";
import {
	createArticlePageCrawlerFactory,
	createMediaCrawlerFactory,
} from "./wechat-crawlee-test-support.ts";

describe("FeedWe capture", () => {
	it("normalizes account names into stable source-bucket asset slugs", () => {
		expect(normalizeWeChatAccountSlug("示例大学学生会")).toBe("示例大学学生会");
	});

	it("fails closed when FeedWe returns invalid JSON for a successful provider response", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response("{", {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async createOrVerifyObject(input) {
				return {
					byteSize: input.data.byteLength,
					contentSha256: "f".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};

		await expect(
			captureFeedWeHistory({
				activityAttempt: 1,
				accountName: "示例大学学生会",
				captureRunId: "run-invalid-json",
				artifactStore,
				fetchImplementation,
				maxArticles: 1,
				maxPages: 1,
				provider: {
					baseUrl: "https://www.feedwe.top",
					email: "collector@example.com",
					password: "super-secret-password",
				},
				size: 1,
			}),
		).rejects.toMatchObject({
			code: "provider_response_invalid",
			message: "FeedWe response must be valid JSON.",
		});
	});

	it("passes Activity cancellation to the in-flight FeedWe request", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | null = null;
		const fetchImplementation = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					observedSignal = init?.signal ?? null;
					observedSignal?.addEventListener("abort", () => reject(observedSignal?.reason), {
						once: true,
					});
				}),
		);
		const running = captureFeedWeHistory({
			abortSignal: controller.signal,
			activityAttempt: 1,
			accountName: "示例大学学生会",
			captureRunId: "run-cancelled",
			artifactStore: {
				async createOrVerifyObject(input) {
					return {
						byteSize: input.data.byteLength,
						contentSha256: "f".repeat(64),
						objectKey: input.objectKey,
					};
				},
			},
			fetchImplementation,
			maxArticles: 1,
			maxPages: 1,
			provider: {
				baseUrl: "https://www.feedwe.top",
				email: "collector@example.com",
				password: "super-secret-password",
			},
			size: 1,
		});

		controller.abort();

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(observedSignal).toBe(controller.signal);
	});

	it("captures real article HTML and image artifacts before materializing source-truth", async () => {
		const email = "collector@example.com";
		const password = "super-secret-password";
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						token: "jwt-token-1",
						user: {
							email,
							id: "feedwe-user-1",
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						user: {
							email,
							id: "feedwe-user-1",
							isActive: true,
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						subscriptions: [
							{
								id: "subscription-1",
								wechatAccountId: "account-1",
								wechatAccount: {
									alias: "MUC_xiaohui",
									id: "account-1",
									name: "示例大学学生会",
								},
							},
						],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								id: "article-a",
								summary: "春季通知摘要第一段\n春季通知摘要第二段",
								title: "2026 春季通知",
								url: "https://mp.weixin.qq.com/s/article-a",
								publishDate: "2026-04-26T12:00:00+08:00",
							},
						],
						pagination: {
							hasMore: true,
							nextCursor: "cursor-1",
							total: 2,
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								id: "article-b",
								summary: "夏季通知摘要第一段\n\n夏季通知摘要第二段",
								title: "2026 夏季通知",
								url: "https://mp.weixin.qq.com/s/article-b",
								publishDate: "2026-04-27T12:00:00+08:00",
							},
						],
						pagination: {
							hasMore: false,
							nextCursor: null,
							total: 2,
						},
					}),
					{ status: 200 },
				),
			);
		const writes: Array<{ objectKey: string; text: string }> = [];
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async createOrVerifyObject(input) {
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
		const articlePageCrawlerFactory = createArticlePageCrawlerFactory({
			"https://mp.weixin.qq.com/s/article-a": `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="2026 春季通知" />
    <meta property="og:description" content="春季通知摘要第一段&#10;春季通知摘要第二段" />
    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/article-a-cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <h1 id="activity-name">2026 春季通知</h1>
    <div id="js_content">
      <section><p>春季通知正文第一段</p></section>
      <section><p>春季通知正文第二段</p></section>
      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-a-inline-1/0?wx_fmt=png" />
      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-a-inline-2/0?wx_fmt=png" />
    </div>
    <script>window.ct = 1777166101;</script>
  </body>
</html>`,
			"https://mp.weixin.qq.com/s/article-b": `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="2026 夏季通知" />
    <meta property="og:description" content="夏季通知摘要第一段&#10;夏季通知摘要第二段" />
    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/article-b-cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <h1 id="activity-name">2026 夏季通知</h1>
    <div id="js_content">
      <section><p>夏季通知正文第一段</p></section>
      <section><p>夏季通知正文第二段</p></section>
      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-b-inline-1/0?wx_fmt=png" />
    </div>
    <script>window.ct = 1777252501;</script>
  </body>
</html>`,
		});
		const mediaCrawlerFactory = createMediaCrawlerFactory({
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/article-a-cover/0?wx_fmt=jpeg": {
				contentType: "image/jpeg",
				body: "cover-a",
			},
			"https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-a-inline-1/0?wx_fmt=png": {
				contentType: "image/png",
				body: "inline-a-1",
			},
			"https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-a-inline-2/0?wx_fmt=png": {
				contentType: "image/png",
				body: "inline-a-2",
			},
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/article-b-cover/0?wx_fmt=jpeg": {
				contentType: "image/jpeg",
				body: "cover-b",
			},
			"https://mmbiz.qpic.cn/sz_mmbiz_png/example/article-b-inline-1/0?wx_fmt=png": {
				contentType: "image/png",
				body: "inline-b-1",
			},
		});

		const result = await captureFeedWeHistory({
			activityAttempt: 1,
			accountName: "示例大学学生会",
			captureRunId: "run-history",
			articlePageCrawlerFactory,
			artifactStore,
			fetchImplementation,
			maxArticles: 10,
			maxPages: 3,
			mediaCrawlerFactory,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			provider: {
				baseUrl: "https://www.feedwe.top",
				email,
				password,
			},
			size: 1,
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(5);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://www.feedwe.top/api/auth/login",
			expect.objectContaining({
				body: JSON.stringify({ email, password }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://www.feedwe.top/api/auth/me",
			expect.objectContaining({
				headers: { Authorization: "Bearer jwt-token-1" },
				method: "GET",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			3,
			"https://www.feedwe.top/api/subscriptions",
			expect.objectContaining({
				headers: { Authorization: "Bearer jwt-token-1" },
				method: "GET",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			4,
			"https://www.feedwe.top/api/articles?accountId=account-1&limit=1",
			expect.objectContaining({
				headers: { Authorization: "Bearer jwt-token-1" },
				method: "GET",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			5,
			"https://www.feedwe.top/api/articles?accountId=account-1&cursor=cursor-1&limit=1",
			expect.objectContaining({
				headers: { Authorization: "Bearer jwt-token-1" },
				method: "GET",
			}),
		);
		expect(result.summary).toEqual({
			artifactUploads: 26,
			articlesMaterialized: 2,
			articlesSeen: 2,
			bodyCapturedArticles: 2,
			bodyMissingArticles: 0,
			failures: 0,
			mediaCaptureArtifacts: 10,
			mediaCapturedCount: 5,
			mediaCaptureFailedCount: 0,
			mediaReferenceCount: 5,
			pagesFetched: 2,
			pageCaptureArtifacts: 16,
			pageCapturesFailed: 0,
			pageCapturesSucceeded: 2,
			sourceTruthArtifacts: 6,
		});
		const objectKeys = writes.map((item) => item.objectKey);
		expect(objectKeys).toEqual(
			expect.arrayContaining([
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/raw_[a-f0-9]{16}\/provider\/feedwe\/provider-response\.jsonl$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/[^/]+\/runs\/run-history\/attempts\/1\/pages\/[01]\/feedwe-request-summary\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/article-manifest\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/content-blocks\.jsonl$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/source-truth\/media-refs\.jsonl$/,
				),
			]),
		);
		expect(objectKeys).toEqual(
			expect.arrayContaining([
				expect.stringMatching(
					/^wechat_official_account\/[^/]+\/runs\/run-history\/attempts\/1\/articles\/woa_article_[a-f0-9]{24}\/wechat-article-page\.html$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/[^/]+\/runs\/run-history\/attempts\/1\/articles\/woa_article_[a-f0-9]{24}\/wechat-article-fetch-metadata\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/provider\/wechat-page-parser\/page-extraction\.json$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/示例大学学生会\/2026\/woa_ver_[a-f0-9]{24}\/capture\/media\/[a-z0-9-]+\/original\.(jpg|png)$/,
				),
				expect.stringMatching(
					/^wechat_official_account\/[^/]+\/runs\/run-history\/attempts\/1\/articles\/woa_article_[a-f0-9]{24}\/media\/[a-z0-9-]+\/fetch-metadata\.json$/,
				),
			]),
		);
		expect(objectKeys).toHaveLength(26);
		expect(writes.some((item) => item.objectKey.includes("/source-truth/"))).toBe(true);
		expect(writes.some((item) => item.objectKey.endsWith("/wechat-article-page.html"))).toBe(true);
		expect(
			writes.some((item) => item.objectKey.endsWith("/wechat-article-fetch-metadata.json")),
		).toBe(true);
		expect(
			writes.some((item) =>
				item.objectKey.includes("/provider/wechat-page-parser/page-extraction.json"),
			),
		).toBe(true);
		expect(
			writes.some(
				(item) =>
					item.objectKey.includes("/capture/media/") && item.objectKey.endsWith("/original.png"),
			),
		).toBe(true);
		expect(
			writes.find((item) => item.objectKey.endsWith("/source-truth/article-manifest.json"))?.text,
		).toContain('"schemaVersion": "wechat_official_account_article_manifest.v3"');
		expect(
			writes.find((item) => item.objectKey.endsWith("/source-truth/media-refs.jsonl"))?.text,
		).toContain('"captureStatus":"captured"');
		expect(
			writes.find((item) => item.objectKey.endsWith("/source-truth/media-refs.jsonl"))?.text,
		).toContain('"objectKey":"wechat_official_account/');
		expect(writes.some((item) => item.objectKey.includes("/projection/"))).toBe(false);
		expect(JSON.stringify(writes)).not.toContain(password);
	});

	it("enforces page and article budgets before downstream processing", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						token: "jwt-token-1",
						user: { id: "feedwe-user-1" },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						user: { id: "feedwe-user-1", isActive: true },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						subscriptions: [
							{
								wechatAccountId: "account-1",
								wechatAccount: {
									alias: "MUC_xiaohui",
									id: "account-1",
									name: "示例大学学生会",
								},
							},
						],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								id: "article-a",
								summary: "A 摘要",
								title: "A",
								url: "https://mp.weixin.qq.com/s/article-a",
								publishDate: "2026-04-27T12:00:00+08:00",
							},
							{
								id: "article-b",
								summary: "B 正文",
								title: "B",
								url: "https://mp.weixin.qq.com/s/article-b",
								publishDate: "2026-04-27T12:01:00+08:00",
							},
						],
						pagination: {
							hasMore: true,
							nextCursor: "cursor-1",
							total: 100,
						},
					}),
					{ status: 200 },
				),
			);
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async createOrVerifyObject(input) {
				return {
					byteSize: input.data.byteLength,
					contentSha256: "e".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const articlePageCrawlerFactory = createArticlePageCrawlerFactory({
			"https://mp.weixin.qq.com/s/article-a": `<!doctype html>
<html>
  <body>
    <h1 id="activity-name">A</h1>
    <div id="js_content"><section><p>A 正文</p></section></div>
  </body>
</html>`,
		});

		const result = await captureFeedWeHistory({
			activityAttempt: 1,
			accountName: "示例大学学生会",
			captureRunId: "run-budget",
			articlePageCrawlerFactory,
			artifactStore,
			fetchImplementation,
			maxArticles: 1,
			maxPages: 5,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			provider: {
				baseUrl: "https://www.feedwe.top",
				email: "collector@example.com",
				password: "super-secret-password",
			},
			size: 2,
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(4);
		expect(result.planningOutcome).toBe("article_budget_exhausted");
		expect(result.summary.articlesSeen).toBe(2);
		expect(result.summary.articlesMaterialized).toBe(1);
	});

	it("fails closed for verification pages while still persisting page capture evidence", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						token: "jwt-token-1",
						user: { id: "feedwe-user-1" },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						user: { id: "feedwe-user-1", isActive: true },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						subscriptions: [
							{
								wechatAccountId: "account-1",
								wechatAccount: {
									alias: "MUC_xiaohui",
									id: "account-1",
									name: "示例大学学生会",
								},
							},
						],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						articles: [
							{
								id: "article-verify",
								summary: "详情见图片",
								title: "验证页样例",
								url: "https://mp.weixin.qq.com/s/article-verify",
								publishDate: "2026-04-27T12:00:00+08:00",
							},
						],
						pagination: {
							hasMore: false,
							nextCursor: null,
							total: 1,
						},
					}),
					{ status: 200 },
				),
			);
		const writes: Array<{ objectKey: string; text: string }> = [];
		const artifactStore: WeChatOfficialAccountArtifactStore = {
			async createOrVerifyObject(input) {
				const text = new TextDecoder().decode(input.data);
				writes.push({ objectKey: input.objectKey, text });
				return {
					byteSize: input.data.byteLength,
					contentSha256: "e".repeat(64),
					objectKey: input.objectKey,
					recordCount: input.recordCount,
				};
			},
		};
		const articlePageCrawlerFactory = createArticlePageCrawlerFactory({
			"https://mp.weixin.qq.com/s/article-verify": `<!doctype html>
<html>
  <body>
    <div id="wappoc_appmsgcaptcha">环境异常</div>
    <button>去验证</button>
  </body>
</html>`,
		});

		const result = await captureFeedWeHistory({
			activityAttempt: 1,
			accountName: "示例大学学生会",
			captureRunId: "run-verification",
			articlePageCrawlerFactory,
			artifactStore,
			fetchImplementation,
			maxArticles: 5,
			maxPages: 1,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			provider: {
				baseUrl: "https://www.feedwe.top",
				email: "collector@example.com",
				password: "super-secret-password",
			},
			size: 10,
		});

		expect(result.summary).toEqual({
			artifactUploads: 8,
			articlesMaterialized: 1,
			articlesSeen: 1,
			bodyCapturedArticles: 0,
			bodyMissingArticles: 1,
			failures: 1,
			mediaCaptureArtifacts: 0,
			mediaCapturedCount: 0,
			mediaCaptureFailedCount: 0,
			mediaReferenceCount: 0,
			pagesFetched: 1,
			pageCaptureArtifacts: 3,
			pageCapturesFailed: 1,
			pageCapturesSucceeded: 0,
			sourceTruthArtifacts: 3,
		});
		expect(
			writes.find((item) => item.objectKey.endsWith("/wechat-article-fetch-metadata.json"))?.text,
		).toContain('"pageKind": "verification"');
		expect(
			writes.find((item) => item.objectKey.endsWith("/wechat-article-page.html"))?.text,
		).toContain("环境异常");
		expect(
			writes.find((item) =>
				item.objectKey.includes("/provider/wechat-page-parser/page-extraction.json"),
			)?.text,
		).toContain('"pageKind": "verification"');
		expect(
			writes.find((item) => item.objectKey.endsWith("/source-truth/article-manifest.json"))?.text,
		).toContain('"bodyState": "fetch_failed"');
		expect(
			writes.find((item) => item.objectKey.endsWith("/source-truth/content-blocks.jsonl"))?.text,
		).toContain('"blockRole":"summary"');
	});
});
