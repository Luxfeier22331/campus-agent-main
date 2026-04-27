import { load } from "cheerio";
import type { CapturedWeChatOfficialAccountArticlePage } from "wechat-official-account-core";

export const WECHAT_ARTICLE_PAGE_PARSER_VERSION = "wechat-page-parser.v1";

export interface ParsedWeChatOfficialAccountArticlePage {
	bodyBlocks: string[];
	coverImageUrl: string | null;
	inlineImageUrls: string[];
	publishTime: string | null;
	publishTimeSource: string | null;
	summary: string | null;
	title: string | null;
}

export async function fetchWeChatOfficialAccountArticlePage(input: {
	articleUrl: string;
	fetchImplementation?: typeof fetch;
	now?: () => Date;
}): Promise<CapturedWeChatOfficialAccountArticlePage> {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const now = input.now ?? (() => new Date());
	const response = await fetchImplementation(input.articleUrl, {
		headers: {
			accept: "text/html,application/xhtml+xml",
			"user-agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
		},
		redirect: "follow",
	});
	const fetchedAt = now().toISOString();
	const finalUrl = response.url?.trim() || input.articleUrl.trim();
	const contentType = response.headers.get("content-type");
	if (!response.ok) {
		return {
			bodyBlocks: [],
			contentType,
			coverImageUrl: null,
			fetchedAt,
			finalUrl,
			inlineImageUrls: [],
			parserVersion: WECHAT_ARTICLE_PAGE_PARSER_VERSION,
			publishTime: null,
			publishTimeSource: null,
			rawHtml: null,
			statusCode: response.status,
			summary: null,
			title: null,
		};
	}
	const html = await response.text();
	const parsed = parseWeChatOfficialAccountArticlePageHtml({
		articleUrl: finalUrl,
		html,
	});
	return {
		...parsed,
		contentType,
		fetchedAt,
		finalUrl,
		parserVersion: WECHAT_ARTICLE_PAGE_PARSER_VERSION,
		statusCode: response.status,
		rawHtml: html,
	};
}

export function parseWeChatOfficialAccountArticlePageHtml(input: {
	articleUrl: string;
	html: string;
}): ParsedWeChatOfficialAccountArticlePage {
	const $ = load(input.html);
	const contentRoot = $("#js_content").first().length
		? $("#js_content").first()
		: $(".rich_media_content").first();
	const title = firstText(
		normalizeBlockText($("#activity-name").first().text()),
		attributeContent($, 'meta[property="og:title"]', "content"),
	);
	const summary = normalizeMultilineText(
		firstText(
			attributeContent($, 'meta[property="og:description"]', "content"),
			attributeContent($, 'meta[name="description"]', "content"),
		),
	);
	const coverImageUrl = normalizeOptionalUrl(
		firstText(
			attributeContent($, 'meta[property="og:image"]', "content"),
			attributeContent($, 'meta[name="twitter:image"]', "content"),
		),
	);
	const bodyBlocks = extractBodyBlocks($, contentRoot);
	const inlineImageUrls = extractInlineImageUrls($, contentRoot);
	const publishTime = extractPublishTime(input.html);
	return {
		bodyBlocks,
		coverImageUrl,
		inlineImageUrls,
		publishTime: publishTime?.value ?? null,
		publishTimeSource: publishTime?.source ?? null,
		summary,
		title,
	};
}

function extractBodyBlocks($: ReturnType<typeof load>, contentRoot: any) {
	if (!contentRoot.length) {
		return [];
	}
	const blocks: string[] = [];
	const seen = new Set<string>();
	contentRoot.find("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre").each((_, element) => {
		const text = normalizeBlockText($(element).text());
		if (!text || seen.has(text)) {
			return;
		}
		seen.add(text);
		blocks.push(text);
	});
	if (blocks.length > 0) {
		return blocks;
	}
	contentRoot.find("section").each((_, element) => {
		const section = $(element);
		if (section.find("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre").length > 0) {
			return;
		}
		const text = normalizeBlockText(section.text());
		if (!text || seen.has(text)) {
			return;
		}
		seen.add(text);
		blocks.push(text);
	});
	return blocks;
}

function extractInlineImageUrls($: ReturnType<typeof load>, contentRoot: any) {
	if (!contentRoot.length) {
		return [];
	}
	const urls: string[] = [];
	const seen = new Set<string>();
	contentRoot.find("img").each((_, element) => {
		const image = $(element);
		const source = firstText(image.attr("data-src"), image.attr("src"));
		const normalized = normalizeOptionalUrl(source);
		if (!normalized || seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		urls.push(normalized);
	});
	return urls;
}

function extractPublishTime(html: string): { source: string; value: string } | null {
	const directMatches: Array<[RegExp, string]> = [
		[/window\.ct\s*=\s*["']?(?<seconds>\d{10})["']?/u, "window.ct"],
		[/var\s+ct\s*=\s*["']?(?<seconds>\d{10})["']?/u, "var ct"],
	];
	for (const [pattern, source] of directMatches) {
		const match = pattern.exec(html);
		const seconds = match?.groups?.seconds;
		if (!seconds) {
			continue;
		}
		const value = new Date(Number.parseInt(seconds, 10) * 1000).toISOString();
		return { source, value };
	}
	return null;
}

function attributeContent(
	$: ReturnType<typeof load>,
	selector: string,
	attributeName: string,
): string | null {
	const value = $(selector).first().attr(attributeName);
	return value?.trim() ? value.trim() : null;
}

function normalizeBlockText(value: string): string {
	return value
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeMultilineText(value: string | null): string | null {
	if (!value) {
		return null;
	}
	return value
		.split(/\r?\n/u)
		.map((line) => normalizeBlockText(line))
		.filter(Boolean)
		.join("\n");
}

function normalizeOptionalUrl(value: string | null): string | null {
	if (!value?.trim()) {
		return null;
	}
	const parsed = new URL(value.trim());
	parsed.hash = "";
	return parsed.toString();
}

function firstText(...values: Array<string | null | undefined>): string | null {
	for (const value of values) {
		if (value?.trim()) {
			return value.trim();
		}
	}
	return null;
}
