import { BasicCrawler, CheerioCrawler, type RequestOptions } from "crawlee";
import type { CapturedWeChatOfficialAccountArticlePage } from "wechat-official-account-core";
import { sha256Hex } from "./capture-hashing.ts";
import {
	buildCapturedArticleMediaPayload,
	type CapturedArticleMediaPayload,
} from "./capture-media.ts";
import { createWeChatCrawlerConfiguration } from "./crawlee-runtime.ts";
import {
	parseWeChatOfficialAccountArticlePageHtml,
	WECHAT_ARTICLE_PAGE_PARSER_VERSION,
	WECHAT_ARTICLE_REQUEST_HEADERS,
} from "./wechat-article-page.ts";

const WECHAT_MEDIA_REQUEST_HEADERS = {
	accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
	"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
	"user-agent":
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
};

export async function runWeChatArticlePageCrawleeCapture(input: {
	articleUrl: string;
	crawlerFactory?: WeChatArticlePageCrawlerFactory;
	now?: () => Date;
	requestMaxRetries?: number;
}): Promise<CapturedWeChatOfficialAccountArticlePage> {
	const now = input.now ?? (() => new Date());
	const results = new Map<string, CapturedWeChatOfficialAccountArticlePage>();
	const failedRequests: Error[] = [];
	const requestHandler = async (context: WeChatArticlePageCrawlerRequestHandlerContext) => {
		const fetchedAt = now().toISOString();
		const finalUrl = context.request.loadedUrl?.trim() || context.request.url.trim();
		const contentType =
			context.contentType?.type ??
			normalizeHeaderValue(context.response.headers?.["content-type"]) ??
			null;
		const statusCode = context.response.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			results.set(context.request.uniqueKey, {
				bodyBlocks: [],
				contentType,
				coverImageUrl: null,
				fetchErrorMessage: null,
				fetchedAt,
				finalUrl,
				inlineImageUrls: [],
				pageKind: "fetch_error",
				parserVersion: WECHAT_ARTICLE_PAGE_PARSER_VERSION,
				publishTime: null,
				publishTimeSource: null,
				rawHtml: null,
				statusCode,
				summary: null,
				title: null,
			});
			return;
		}
		const html = typeof context.body === "string" ? context.body : context.body.toString("utf8");
		const parsed = parseWeChatOfficialAccountArticlePageHtml({
			articleUrl: finalUrl,
			html,
		});
		results.set(context.request.uniqueKey, {
			...parsed,
			contentType,
			fetchedAt,
			finalUrl,
			parserVersion: WECHAT_ARTICLE_PAGE_PARSER_VERSION,
			rawHtml: html,
			statusCode,
		});
	};
	const failedRequestHandler = async (
		context: WeChatArticlePageCrawlerRequestHandlerContext,
		error: Error,
	) => {
		failedRequests.push(
			new Error(`WeChat article page request failed for ${context.request.url}: ${error.message}`),
		);
	};
	const crawler = (input.crawlerFactory ?? createDefaultWeChatArticlePageCrawler)({
		failedRequestHandler,
		requestHandler,
		requestMaxRetries: input.requestMaxRetries ?? 1,
	});
	const uniqueKey = buildWeChatArticlePageUniqueKey(input.articleUrl);
	await crawler.run([
		{
			headers: WECHAT_ARTICLE_REQUEST_HEADERS,
			uniqueKey,
			url: input.articleUrl,
		},
	]);
	if (failedRequests.length > 0) {
		throw failedRequests[0];
	}
	const captured = results.get(uniqueKey);
	if (!captured) {
		throw new Error(`WeChat article page request produced no capture for ${input.articleUrl}.`);
	}
	return captured;
}

export async function runWeChatMediaCrawleeCapture(input: {
	articleSourceUrl: string;
	coverImageUrl: string | null;
	crawlerFactory?: WeChatMediaCrawlerFactory;
	inlineImageUrls: string[];
	now: () => Date;
	requestMaxRetries?: number;
}): Promise<CapturedArticleMediaPayload[]> {
	const requests = buildWeChatMediaRequests(input);
	if (requests.length === 0) {
		return [];
	}
	const results = new Map<string, CapturedArticleMediaPayload>();
	const requestHandler = async (context: WeChatMediaCrawlerRequestHandlerContext) => {
		const userData = parseWeChatMediaUserData(context.request.userData);
		const capturedAt = input.now().toISOString();
		const response = await context.sendRequest({
			headers: {
				...WECHAT_MEDIA_REQUEST_HEADERS,
				referer: input.articleSourceUrl,
			},
			responseType: "buffer",
		});
		const contentType = normalizeImageContentType(
			normalizeHeaderValue(response.headers?.["content-type"]),
		);
		if (!contentType) {
			throw new Error("non-image content-type");
		}
		results.set(
			context.request.uniqueKey,
			buildCapturedArticleMediaPayload({
				capturedAt,
				contentType,
				errorMessage: null,
				finalUrl: normalizeMediaUrl(response.url) ?? context.request.url,
				imageBytes: toBinaryBody(response.body),
				normalizedSourceUrl: userData.normalizedSourceUrl,
				sourceUrl: userData.sourceUrl,
			}),
		);
	};
	const failedRequestHandler = async (
		context: WeChatMediaCrawlerRequestHandlerContext,
		error: Error,
	) => {
		const userData = parseWeChatMediaUserData(context.request.userData);
		results.set(
			context.request.uniqueKey,
			buildCapturedArticleMediaPayload({
				capturedAt: input.now().toISOString(),
				contentType: null,
				errorMessage: error.message,
				finalUrl: null,
				imageBytes: null,
				normalizedSourceUrl: userData.normalizedSourceUrl,
				sourceUrl: userData.sourceUrl,
			}),
		);
	};
	const crawler = (input.crawlerFactory ?? createDefaultWeChatMediaCrawler)({
		failedRequestHandler,
		requestHandler,
		requestMaxRetries: input.requestMaxRetries ?? 1,
	});
	await crawler.run(requests);
	return requests.map((request) => {
		const captured = results.get(String(request.uniqueKey));
		if (!captured) {
			throw new Error(`WeChat media request produced no capture for ${request.url}.`);
		}
		return captured;
	});
}

export interface WeChatArticlePageCrawlerRequestHandlerContext {
	body: string | Buffer;
	contentType: { type: string } | null;
	request: {
		loadedUrl?: string;
		uniqueKey: string;
		url: string;
	};
	response: {
		headers?: Record<string, string | string[] | undefined>;
		statusCode?: number;
	};
}

export interface WeChatArticlePageCrawlerFactoryInput {
	failedRequestHandler: (
		context: WeChatArticlePageCrawlerRequestHandlerContext,
		error: Error,
	) => Promise<void>;
	requestHandler: (context: WeChatArticlePageCrawlerRequestHandlerContext) => Promise<void>;
	requestMaxRetries: number;
}

export type WeChatArticlePageCrawlerFactory = (input: WeChatArticlePageCrawlerFactoryInput) => {
	run(requests: RequestOptions[]): Promise<unknown>;
};

export interface WeChatMediaCrawlerRequestHandlerContext {
	request: {
		uniqueKey: string;
		url: string;
		userData?: unknown;
	};
	sendRequest(input: { headers: Record<string, string>; responseType: "buffer" }): Promise<{
		body: Buffer | Uint8Array | string;
		headers?: Record<string, string | string[] | undefined>;
		url?: string;
	}>;
}

export interface WeChatMediaCrawlerFactoryInput {
	failedRequestHandler: (
		context: WeChatMediaCrawlerRequestHandlerContext,
		error: Error,
	) => Promise<void>;
	requestHandler: (context: WeChatMediaCrawlerRequestHandlerContext) => Promise<void>;
	requestMaxRetries: number;
}

export type WeChatMediaCrawlerFactory = (input: WeChatMediaCrawlerFactoryInput) => {
	run(requests: RequestOptions[]): Promise<unknown>;
};

function createDefaultWeChatArticlePageCrawler(input: WeChatArticlePageCrawlerFactoryInput) {
	const crawler = new CheerioCrawler(
		{
			failedRequestHandler: async (context, error) => {
				await input.failedRequestHandler(
					{
						body: "",
						contentType: null,
						request: {
							loadedUrl: context.request.loadedUrl,
							uniqueKey: context.request.uniqueKey,
							url: context.request.url,
						},
						response: {},
					},
					error,
				);
			},
			maxConcurrency: 2,
			maxRequestRetries: input.requestMaxRetries,
			requestHandler: async (context) => {
				await input.requestHandler({
					body: context.body,
					contentType: context.contentType,
					request: {
						loadedUrl: context.request.loadedUrl,
						uniqueKey: context.request.uniqueKey,
						url: context.request.url,
					},
					response: {
						headers: context.response.headers as Record<string, string | string[] | undefined>,
						statusCode: context.response.statusCode,
					},
				});
			},
			requestHandlerTimeoutSecs: 30,
		},
		createWeChatCrawlerConfiguration("article"),
	);
	return {
		run: async (requests: RequestOptions[]) => await crawler.run(requests),
	};
}

function createDefaultWeChatMediaCrawler(input: WeChatMediaCrawlerFactoryInput) {
	const crawler = new BasicCrawler(
		{
			failedRequestHandler: async (context, error) => {
				await input.failedRequestHandler(
					{
						request: {
							uniqueKey: context.request.uniqueKey,
							url: context.request.url,
							userData: context.request.userData,
						},
						sendRequest: async (overrideOptions) => await context.sendRequest(overrideOptions),
					},
					error,
				);
			},
			maxConcurrency: 4,
			maxRequestRetries: input.requestMaxRetries,
			requestHandler: async (context) => {
				await input.requestHandler({
					request: {
						uniqueKey: context.request.uniqueKey,
						url: context.request.url,
						userData: context.request.userData,
					},
					sendRequest: async (overrideOptions) => await context.sendRequest(overrideOptions),
				});
			},
			requestHandlerTimeoutSecs: 30,
		},
		createWeChatCrawlerConfiguration("media"),
	);
	return {
		run: async (requests: RequestOptions[]) => await crawler.run(requests),
	};
}

function buildWeChatMediaRequests(input: {
	coverImageUrl: string | null;
	inlineImageUrls: string[];
}): RequestOptions[] {
	const requests: RequestOptions[] = [];
	const seen = new Set<string>();
	for (const candidate of [input.coverImageUrl, ...input.inlineImageUrls]) {
		const sourceUrl = normalizeMediaUrl(candidate);
		if (!sourceUrl || seen.has(sourceUrl)) {
			continue;
		}
		seen.add(sourceUrl);
		requests.push({
			uniqueKey: buildWeChatMediaUniqueKey(sourceUrl),
			url: sourceUrl,
			userData: {
				normalizedSourceUrl: sourceUrl,
				sourceUrl,
			},
		});
	}
	return requests;
}

function parseWeChatMediaUserData(value: unknown): {
	normalizedSourceUrl: string;
	sourceUrl: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("WeChat media crawler request is missing userData.");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.normalizedSourceUrl !== "string" || typeof record.sourceUrl !== "string") {
		throw new Error("WeChat media crawler request userData is invalid.");
	}
	return {
		normalizedSourceUrl: record.normalizedSourceUrl,
		sourceUrl: record.sourceUrl,
	};
}

function buildWeChatArticlePageUniqueKey(articleUrl: string): string {
	return `wechat_article_page:${sha256Hex(articleUrl).slice(0, 16)}`;
}

function buildWeChatMediaUniqueKey(mediaUrl: string): string {
	return `wechat_media:${sha256Hex(mediaUrl).slice(0, 16)}`;
}

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) {
		return value.join(", ").trim() || null;
	}
	return value?.trim() || null;
}

function normalizeMediaUrl(value: string | null | undefined): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const parsed = new URL(value.trim());
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return null;
	}
}

function normalizeImageContentType(value: string | null): string | null {
	const normalized = String(value || "")
		.split(";", 1)[0]
		.trim()
		.toLowerCase();
	return normalized.startsWith("image/") ? normalized : null;
}

function toBinaryBody(value: Buffer | Uint8Array | string): Uint8Array {
	if (typeof value === "string") {
		return new TextEncoder().encode(value);
	}
	return value;
}
