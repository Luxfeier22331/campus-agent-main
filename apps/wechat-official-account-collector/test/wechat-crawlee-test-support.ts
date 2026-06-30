import type {
	WeChatArticlePageCrawlerFactory,
	WeChatMediaCrawlerFactory,
} from "../src/wechat-crawlee-runners.ts";

export function createArticlePageCrawlerFactory(
	pages: Record<string, string>,
): WeChatArticlePageCrawlerFactory {
	return (input) => ({
		run: async (requests) => {
			for (const request of requests) {
				const html = pages[request.url];
				if (!html) {
					throw new Error(`missing fake WeChat article page for ${request.url}`);
				}
				assertArticleRequestHeaders(request.headers);
				await input.requestHandler({
					body: html,
					contentType: { type: "text/html" },
					request: {
						loadedUrl: request.url,
						uniqueKey: request.uniqueKey ?? "",
						url: request.url,
					},
					response: {
						headers: { "content-type": "text/html; charset=utf-8" },
						statusCode: 200,
					},
				});
			}
		},
	});
}

export function createMediaCrawlerFactory(
	mediaByUrl: Record<string, { body: string; contentType: string }>,
): WeChatMediaCrawlerFactory {
	return (input) => ({
		run: async (requests) => {
			for (const request of requests) {
				await input.requestHandler({
					fetchMedia: async (fetchInput) => {
						const media = mediaByUrl[fetchInput.url];
						if (!media) {
							throw new Error(`missing fake WeChat media for ${fetchInput.url}`);
						}
						assertMediaRequestHeaders(fetchInput.headers);
						return {
							contentType: media.contentType,
							finalUrl: fetchInput.url,
							imageBytes: new TextEncoder().encode(media.body),
						};
					},
					request: {
						uniqueKey: request.uniqueKey ?? "",
						url: request.url,
						userData: request.userData,
					},
				});
			}
		},
	});
}

function assertArticleRequestHeaders(headers: unknown): asserts headers is Record<string, string> {
	if (!isHeaderRecord(headers)) {
		throw new Error("expected WeChat article request headers to be a record");
	}
	assertHeaderEquals(headers, "accept", "text/html,application/xhtml+xml");
	assertHeaderEquals(headers, "accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
	assertHeaderContains(headers, "user-agent", "Windows NT");
}

function assertMediaRequestHeaders(headers: Record<string, string>): void {
	assertHeaderEquals(headers, "accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
	assertHeaderContains(headers, "referer", "https://mp.weixin.qq.com/s/article-");
	assertHeaderContains(headers, "user-agent", "Mozilla/5.0");
}

function isHeaderRecord(headers: unknown): headers is Record<string, string> {
	if (typeof headers !== "object" || headers === null) {
		return false;
	}
	return Object.values(headers).every((value) => typeof value === "string");
}

function assertHeaderEquals(headers: Record<string, string>, key: string, expected: string): void {
	if (headers[key] !== expected) {
		throw new Error(`expected ${key} header to equal ${expected}`);
	}
}

function assertHeaderContains(
	headers: Record<string, string>,
	key: string,
	expected: string,
): void {
	const actual = headers[key];
	if (typeof actual !== "string" || !actual.includes(expected)) {
		throw new Error(`expected ${key} header to contain ${expected}`);
	}
}
