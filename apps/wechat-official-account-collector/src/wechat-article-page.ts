import { type Cheerio, type CheerioAPI, type Element, load } from "cheerio";
import type {
	CapturedWeChatOfficialAccountArticlePage,
	WeChatArticlePageKind,
} from "wechat-official-account-core";

export const WECHAT_ARTICLE_PAGE_PARSER_VERSION = "wechat-page-parser.v1";
const WECHAT_ARTICLE_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ParsedWeChatOfficialAccountArticlePage {
	bodyBlocks: string[];
	coverImageUrl: string | null;
	inlineImageUrls: string[];
	pageKind: WeChatArticlePageKind;
	publishTime: string | null;
	publishTimeSource: string | null;
	summary: string | null;
	title: string | null;
}

type CheerioElementSelection = Cheerio<Element>;

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
			"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
			"user-agent": WECHAT_ARTICLE_USER_AGENT,
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
			fetchErrorMessage: null,
			fetchedAt,
			finalUrl,
			inlineImageUrls: [],
			pageKind: "fetch_error",
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
	const contentRoot =
		$("#js_content").first().length > 0
			? $("#js_content").first()
			: $(".rich_media_content").first();
	const title = firstText(
		normalizeBlockText($("#activity-name").first().text()),
		attributeContent($, 'meta[property="og:title"]', "content"),
		extractJsDecodeField(input.html, "title"),
	);
	const summary = normalizeMultilineText(
		firstText(
			attributeContent($, 'meta[property="og:description"]', "content"),
			attributeContent($, 'meta[name="description"]', "content"),
			extractJsDecodeField(input.html, "desc"),
		),
	);
	const coverImageUrl = normalizeOptionalUrl(
		firstText(
			attributeContent($, 'meta[property="og:image"]', "content"),
			attributeContent($, 'meta[name="twitter:image"]', "content"),
			extractJsDecodeField(input.html, "cdn_url"),
		),
	);
	const bodyBlocks = extractBodyBlocks($, contentRoot, input.html);
	const inlineImageUrls = extractInlineImageUrls($, contentRoot, input.html);
	const publishTime = extractPublishTime(input.html);
	const pageKind = classifyWeChatArticlePage({
		bodyBlockCount: bodyBlocks.length,
		contentRootPresent: contentRoot.length > 0,
		html: input.html,
		inlineImageUrlCount: inlineImageUrls.length,
	});
	return {
		bodyBlocks,
		coverImageUrl,
		inlineImageUrls,
		pageKind,
		publishTime: publishTime?.value ?? null,
		publishTimeSource: publishTime?.source ?? null,
		summary,
		title,
	};
}

function classifyWeChatArticlePage(input: {
	bodyBlockCount: number;
	contentRootPresent: boolean;
	html: string;
	inlineImageUrlCount: number;
}): WeChatArticlePageKind {
	const verificationMarkers = ["环境异常", "去验证", "wappoc_appmsgcaptcha", "验证后可继续访问"];
	if (verificationMarkers.some((marker) => input.html.includes(marker))) {
		return "verification";
	}
	if (input.contentRootPresent || input.bodyBlockCount > 0 || input.inlineImageUrlCount > 0) {
		return "article";
	}
	return "non_article";
}

function extractBodyBlocks(
	$: CheerioAPI,
	contentRoot: CheerioElementSelection,
	html: string,
) {
	if (contentRoot.length === 0) {
		return splitTextBlocks(extractJsDecodeField(html, "content_noencode"));
	}
	const blocks: string[] = [];
	const seen = new Set<string>();
	contentRoot.find("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre").each((_: number, element: Element) => {
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
	contentRoot.find("section").each((_: number, element: Element) => {
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

function extractInlineImageUrls(
	$: CheerioAPI,
	contentRoot: CheerioElementSelection,
	html: string,
) {
	if (contentRoot.length === 0) {
		return extractPicturePageImageUrls(html);
	}
	const urls: string[] = [];
	const seen = new Set<string>();
	contentRoot.find("img").each((_: number, element: Element) => {
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
	const directMatches: [RegExp, string][] = [
		[/window\.ct\s*=\s*["']?(?<seconds>\d{10})["']?/u, "window.ct"],
		[/var\s+ct\s*=\s*["']?(?<seconds>\d{10})["']?/u, "var ct"],
		[/ori_create_time\s*:\s*["']?(?<seconds>\d{10})["']?\s*(?:\*\s*1)?/u, "ori_create_time"],
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
	const createTime = extractJsDecodeField(html, "create_time");
	if (createTime) {
		const parsed = parseWeChatCreateTime(createTime);
		if (parsed) {
			return { source: "create_time", value: parsed };
		}
	}
	return null;
}

function attributeContent(
	$: ReturnType<typeof load>,
	selector: string,
	attributeName: string,
): string | null {
	const value = $(selector).first().attr(attributeName);
	if (!value?.trim()) {
		return null;
	}
	const decoded = decodeWeChatJsString(value);
	return decoded.trim() ? decoded.trim() : null;
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

function splitTextBlocks(value: string | null): string[] {
	if (!value) {
		return [];
	}
	const blocks: string[] = [];
	const seen = new Set<string>();
	for (const line of value.split(/\r?\n/u)) {
		const normalized = normalizeBlockText(line);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		blocks.push(normalized);
	}
	return blocks;
}

function extractPicturePageImageUrls(html: string): string[] {
	const block = /picture_page_info_list\s*:\s*\[(?<body>[\s\S]*?)\n\s*\]/u.exec(html)?.groups
		?.body;
	if (!block) {
		return [];
	}
	const urls: string[] = [];
	const seen = new Set<string>();
	const pattern = /cdn_url\s*:\s*JsDecode\('(?<value>(?:\\.|[^'])*)'\)/gu;
	for (const match of block.matchAll(pattern)) {
		const normalized = normalizeOptionalUrl(decodeWeChatJsString(match.groups?.value ?? ""));
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		urls.push(normalized);
	}
	return urls;
}

function extractJsDecodeField(html: string, fieldName: string): string | null {
	const escapedField = escapeRegExp(fieldName);
	const pattern = new RegExp(
		`${escapedField}\\s*:\\s*JsDecode\\('(?<value>(?:\\\\.|[^'])*)'\\)`,
		"u",
	);
	const raw = pattern.exec(html)?.groups?.value;
	if (!raw) {
		return null;
	}
	const decoded = decodeWeChatJsString(raw);
	return decoded.trim() ? decoded.trim() : null;
}

function decodeWeChatJsString(value: string): string {
	return decodeHtmlEntities(
		value
			.replace(/\\x(?<hex>[0-9a-fA-F]{2})/gu, (_, hex: string) =>
				String.fromCharCode(Number.parseInt(hex, 16)),
			)
			.replace(/\\u(?<hex>[0-9a-fA-F]{4})/gu, (_, hex: string) =>
				String.fromCharCode(Number.parseInt(hex, 16)),
			)
			.replace(/\\n/gu, "\n")
			.replace(/\\r/gu, "\r")
			.replace(/\\t/gu, "\t")
			.replace(/\\'/gu, "'")
			.replace(/\\"/gu, '"')
			.replace(/\\\\/gu, "\\"),
	);
}

function decodeHtmlEntities(value: string): string {
	if (!(value.includes("&") && value.includes(";"))) {
		return value;
	}
	return load(`<textarea>${value}</textarea>`)("textarea").text();
}

function parseWeChatCreateTime(value: string): string | null {
	const match =
		/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})\s+(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/u.exec(
			value.trim(),
		);
	if (!match?.groups) {
		return null;
	}
	const second = match.groups.second ?? "00";
	const timestamp = Date.UTC(
		Number.parseInt(match.groups.year, 10),
		Number.parseInt(match.groups.month, 10) - 1,
		Number.parseInt(match.groups.day, 10),
		Number.parseInt(match.groups.hour, 10) - 8,
		Number.parseInt(match.groups.minute, 10),
		Number.parseInt(second, 10),
	);
	return new Date(timestamp).toISOString();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
