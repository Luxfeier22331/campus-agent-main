import { describe, expect, it, vi } from "vitest";

import {
	runWeChatArticlePageCrawleeCapture,
	runWeChatMediaCrawleeCapture,
	type WeChatArticlePageCrawlerFactory,
	type WeChatMediaCrawlerFactory,
} from "../src/wechat-crawlee-runners.ts";

describe("WeChat Crawlee runners", () => {
	it("captures mp.weixin article pages through a CheerioCrawler boundary", async () => {
		const run = vi.fn(async (requests) => {
			expect(requests).toEqual([
				expect.objectContaining({
					url: "https://mp.weixin.qq.com/s/article-a",
					uniqueKey: expect.stringMatching(/^wechat_article_page:[a-f0-9]{16}$/),
					headers: expect.objectContaining({
						accept: "text/html,application/xhtml+xml",
						"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
						"user-agent": expect.stringContaining("Windows NT"),
					}),
				}),
			]);
			await requestHandler({
				body: `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="2026 春季通知" />
    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <h1 id="activity-name">2026 春季通知</h1>
    <div id="js_content"><section><p>正文第一段</p></section></div>
  </body>
</html>`,
				contentType: { type: "text/html" },
				request: {
					loadedUrl: "https://mp.weixin.qq.com/s/article-a?chksm=abc",
					uniqueKey: requests[0].uniqueKey ?? "",
					url: "https://mp.weixin.qq.com/s/article-a",
				},
				response: {
					headers: { "content-type": "text/html; charset=utf-8" },
					statusCode: 200,
				},
			});
		});
		let requestHandler: Parameters<WeChatArticlePageCrawlerFactory>[0]["requestHandler"];

		const page = await runWeChatArticlePageCrawleeCapture({
			articleUrl: "https://mp.weixin.qq.com/s/article-a",
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			crawlerFactory: (input) => {
				requestHandler = input.requestHandler;
				expect(input.requestMaxRetries).toBe(1);
				return { run };
			},
		});

		expect(run).toHaveBeenCalledTimes(1);
		expect(page).toMatchObject({
			contentType: "text/html",
			fetchedAt: "2026-04-27T08:00:00.000Z",
			finalUrl: "https://mp.weixin.qq.com/s/article-a?chksm=abc",
			pageKind: "article",
			statusCode: 200,
			title: "2026 春季通知",
			bodyBlocks: ["正文第一段"],
			coverImageUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
		});
		expect(page.rawHtml).toContain("正文第一段");
	});

	it("captures article media through a BasicCrawler boundary", async () => {
		const fetchMedia = vi.fn(async (input: { headers: Record<string, string>; url: string }) => ({
			contentType: input.url.includes("cover") ? "image/jpeg" : "image/png",
			finalUrl: input.url,
			imageBytes: new TextEncoder().encode(input.url.includes("cover") ? "cover" : "inline"),
		}));
		const run = vi.fn(async (requests) => {
			expect(requests).toEqual([
				expect.objectContaining({
					url: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
					uniqueKey: expect.stringMatching(/^wechat_media:[a-f0-9]{16}$/),
					userData: {
						normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
						sourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
					},
				}),
				expect.objectContaining({
					url: "https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png",
					uniqueKey: expect.stringMatching(/^wechat_media:[a-f0-9]{16}$/),
					userData: {
						normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png",
						sourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png",
					},
				}),
			]);
			for (const request of requests) {
				await requestHandler({
					fetchMedia,
					request: {
						uniqueKey: request.uniqueKey ?? "",
						url: request.url,
						userData: request.userData,
					},
				});
			}
		});
		let requestHandler: Parameters<WeChatMediaCrawlerFactory>[0]["requestHandler"];

		const media = await runWeChatMediaCrawleeCapture({
			articleSourceUrl: "https://mp.weixin.qq.com/s/article-a",
			coverImageUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
			inlineImageUrls: [
				"https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png",
				"https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png#ignored",
			],
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			crawlerFactory: (input) => {
				requestHandler = input.requestHandler;
				expect(input.requestMaxRetries).toBe(1);
				return { run };
			},
		});

		expect(run).toHaveBeenCalledTimes(1);
		expect(fetchMedia).toHaveBeenCalledWith({
			url: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
			headers: expect.objectContaining({
				accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
				referer: "https://mp.weixin.qq.com/s/article-a",
				"user-agent": expect.stringContaining("Mozilla/5.0"),
			}),
		});
		expect(media).toHaveLength(2);
		expect(media[0]).toMatchObject({
			byteSize: 5,
			captureStatus: "captured",
			contentType: "image/jpeg",
			mimeType: "image/jpeg",
			normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
		});
		expect(media[1]).toMatchObject({
			byteSize: 6,
			captureStatus: "captured",
			contentType: "image/png",
			mimeType: "image/png",
			normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_png/example/inline/0?wx_fmt=png",
		});
	});

	it("records media fetch_failed only after Crawlee exhausts a media request", async () => {
		const fetchMedia = vi.fn(async () => {
			throw new Error("HTTP 503");
		});
		let requestHandler: Parameters<WeChatMediaCrawlerFactory>[0]["requestHandler"];
		let failedRequestHandler: Parameters<WeChatMediaCrawlerFactory>[0]["failedRequestHandler"];

		const media = await runWeChatMediaCrawleeCapture({
			articleSourceUrl: "https://mp.weixin.qq.com/s/article-a",
			coverImageUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
			inlineImageUrls: [],
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			crawlerFactory: (input) => {
				requestHandler = input.requestHandler;
				failedRequestHandler = input.failedRequestHandler;
				return {
					run: async (requests) => {
						for (const request of requests) {
							const context = {
								fetchMedia,
								request: {
									uniqueKey: request.uniqueKey ?? "",
									url: request.url,
									userData: request.userData,
								},
							};
							try {
								await requestHandler(context);
							} catch (error) {
								await failedRequestHandler(context, error as Error);
							}
						}
					},
				};
			},
		});

		expect(fetchMedia).toHaveBeenCalledTimes(1);
		expect(media).toEqual([
			expect.objectContaining({
				captureStatus: "fetch_failed",
				fetchErrorMessage: "HTTP 503",
				normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
			}),
		]);
	});
});
