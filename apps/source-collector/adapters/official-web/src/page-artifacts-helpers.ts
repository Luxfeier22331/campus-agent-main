import type { AnyNode, Element } from "cheerio";
import type { CheerioCrawlingContext } from "crawlee";
import type { OfficialWebPageFamily } from "./core/index.ts";

const SHANGHAI_TIMEZONE_OFFSET = "+08:00";
export type HtmlDomApi = CheerioCrawlingContext["$"];
export type HtmlDomSelection = ReturnType<HtmlDomApi>;
export type HtmlDomElement = Element;
export type HtmlDomNode = AnyNode;

const PUBLISHED_AT_ALLOWED_PAGE_FAMILIES = new Set<OfficialWebPageFamily>([
	"article_detail",
	"generic_content_page",
]);

export function prepareHtmlForExtraction(input: {
	html: CheerioCrawlingContext["$"];
	finalUrl: string;
}): void {
	hydrateEngine2DetailRichText(input.html, input.finalUrl);
}

function hydrateEngine2DetailRichText(html: CheerioCrawlingContext["$"], finalUrl: string): void {
	if (!isEngine2DetailLikeUrl(finalUrl)) {
		return;
	}

	const $: HtmlDomApi = html;
	const editor = $("#editor1");
	if (editor.length === 0) {
		return;
	}

	const existingText = normalizeText(editor.text());
	if (existingText != null && existingText.length >= 24) {
		return;
	}

	const recoveredHtml = extractEngine2BootstrapRichText($);
	if (recoveredHtml == null) {
		return;
	}

	editor.html(recoveredHtml);
}

function extractEngine2BootstrapRichText($: HtmlDomApi): string | null {
	const candidatePayloads: string[] = [];

	for (const script of $("script").toArray() as HtmlDomNode[]) {
		const scriptText = normalizeOptionalString($(script).html() ?? $(script).text());
		if (scriptText == null || !/renderRichtext\(["']editor1["']\s*,/i.test(scriptText)) {
			continue;
		}

		for (const match of scriptText.matchAll(
			/(?:["']content["']|content)\s*:\s*"((?:\\.|[^"\\])*)"/g,
		)) {
			const decoded = decodeJsonEscapedHtml(match[1] ?? "");
			if (decoded == null) {
				continue;
			}
			candidatePayloads.push(decoded);
		}
	}

	const recovered = candidatePayloads
		.map((value) => value.trim())
		.filter(
			(value) => value.length > 0 && /<(?:p|div|section|article|img|a|ul|ol|table)\b/i.test(value),
		)
		.sort((left, right) => right.length - left.length)[0];

	return recovered ?? null;
}

function decodeJsonEscapedHtml(value: string): string | null {
	try {
		const decoded = JSON.parse(`"${value}"`);
		return typeof decoded === "string" ? decoded : null;
	} catch {
		return null;
	}
}

function isEngine2DetailLikeUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return /^\/engine2\/d\/[^/]+\/[^/]+\/[^/]+$/i.test(url.pathname);
	} catch {
		return false;
	}
}

export function serializeResponseHeaders(
	headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
	return Object.entries(headers).reduce<Record<string, string | string[]>>(
		(result, [key, value]) => {
			if (value == null) {
				return result;
			}
			result[key.toLowerCase()] = Array.isArray(value) ? value : String(value);
			return result;
		},
		{},
	);
}

export function readHeaderValue(
	headers: Record<string, string | string[]>,
	key: string,
): string | null {
	const value = headers[key];
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}
	return value ?? null;
}

export function toJsonLines(records: readonly object[]): string {
	if (records.length === 0) {
		return "";
	}
	return `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

export function normalizeText(value: string | null | undefined): string | null {
	const normalized = normalizeOptionalString(value);
	if (normalized == null) {
		return null;
	}

	const stripped = stripKnownTrackingResidue(normalized).replace(/\s+/g, " ").trim();
	return normalizeSplitCardDateText(stripped);
}

function normalizeSplitCardDateText(value: string): string {
	const splitDateMatch = value.match(/^(?<day>\d{1,2})(?<year>20\d{2})[./-](?<month>\d{1,2})$/);
	if (!splitDateMatch?.groups) {
		return value;
	}

	const day = splitDateMatch.groups.day.padStart(2, "0");
	const month = splitDateMatch.groups.month.padStart(2, "0");
	return `${splitDateMatch.groups.year}-${month}-${day}`;
}

export function normalizePageTitle(value: string | null, siteDisplayName: string): string {
	const normalized = normalizeText(value) ?? "";
	if (normalized.length === 0) {
		return "";
	}

	const segments = normalized
		.split(/[-|｜]/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const first = segments[0] ?? normalized;
	if (
		segments.length > 1 &&
		segments.some((item) => item.toLowerCase() === siteDisplayName.toLowerCase())
	) {
		return first;
	}
	return first;
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

export function extractCanonicalPublishedAt(input: {
	html: CheerioCrawlingContext["$"];
	pageFamily: OfficialWebPageFamily;
}): string | null {
	if (!PUBLISHED_AT_ALLOWED_PAGE_FAMILIES.has(input.pageFamily)) {
		return null;
	}

	const metaSelectors = [
		'meta[property="article:published_time"]',
		'meta[property="article:published"]',
		'meta[name="publishdate"]',
		'meta[name="pubdate"]',
		'meta[name="dc.date"]',
		'meta[name="dc.date.issued"]',
	];
	for (const selector of metaSelectors) {
		for (const element of input.html(selector).toArray() as HtmlDomNode[]) {
			const content = normalizeOptionalString(String(input.html(element).attr("content") ?? ""));
			const publishedAt = parseCanonicalPublishedAt(content);
			if (publishedAt != null) {
				return publishedAt;
			}
		}
	}

	for (const element of input.html("time[datetime]").toArray() as HtmlDomNode[]) {
		const datetime = normalizeOptionalString(String(input.html(element).attr("datetime") ?? ""));
		const publishedAt = parseCanonicalPublishedAt(datetime);
		if (publishedAt != null) {
			return publishedAt;
		}
	}

	for (const element of input.html("time,span,div,p,li").toArray() as HtmlDomNode[]) {
		if (!hasPublicationMetadataContext(input.html, element)) {
			continue;
		}
		const text = normalizeText(input.html(element).text());
		if (text == null) {
			continue;
		}
		if (!(containsPublicationLabel(text) || looksLikeDateText(text))) {
			continue;
		}
		const publishedAt = parseCanonicalPublishedAt(text);
		if (publishedAt != null) {
			return publishedAt;
		}
	}

	return null;
}

function hasPublicationMetadataContext($: HtmlDomApi, element: HtmlDomNode): boolean {
	const candidates = [element, ...($(element).parents().slice(0, 3).toArray() as HtmlDomNode[])];
	return candidates.some((candidate) => {
		const classOrId = `${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`
			.toLowerCase()
			.replace(/[_-]/g, " ");
		return /(publish|发布时间|date|time|arc info|article info|news time|fz time)/.test(classOrId);
	});
}

function containsPublicationLabel(text: string): boolean {
	return /(发布时间|发布于|发布:|发布：|更新时间|更新于|日期:|日期：|时间:|时间：)/.test(text);
}

function parseCanonicalPublishedAt(value: string | null): string | null {
	if (value == null) {
		return null;
	}

	const normalized = value.replace(/[：]/g, ":").replace(/\s+/g, " ").trim();
	const isoLikeMatch = normalized.match(
		/\b(20\d{2}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/i,
	);
	if (isoLikeMatch?.[1]) {
		const date = new Date(isoLikeMatch[1]);
		if (!Number.isNaN(date.getTime())) {
			return formatDateToShanghaiIso(date);
		}
	}

	const match = normalized.match(
		/(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})(?:[日号]?)?(?:\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
	);
	if (!match) {
		return null;
	}

	return formatShanghaiIsoFromParts({
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
		hour: match[4] == null ? 0 : Number(match[4]),
		minute: match[5] == null ? 0 : Number(match[5]),
		second: match[6] == null ? 0 : Number(match[6]),
	});
}

function formatDateToShanghaiIso(date: Date): string {
	const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
	return formatShanghaiIsoFromParts({
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		second: shifted.getUTCSeconds(),
	});
}

function formatShanghaiIsoFromParts(input: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}): string {
	return [
		`${String(input.year).padStart(4, "0")}-${String(input.month).padStart(2, "0")}-${String(input.day).padStart(2, "0")}`,
		`T${String(input.hour).padStart(2, "0")}:${String(input.minute).padStart(2, "0")}:${String(input.second).padStart(2, "0")}${SHANGHAI_TIMEZONE_OFFSET}`,
	].join("");
}

export function resolveOptionalUrl(
	href: string | null | undefined,
	baseUrl: string,
): string | null {
	if (typeof href !== "string" || href.trim().length === 0) {
		return null;
	}

	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return null;
	}
}

export function resolveAnchorTargetUrl(
	$: HtmlDomApi,
	element: HtmlDomNode,
	baseUrl: string,
): string | null {
	const href = normalizeOptionalString(String($(element).attr("href") ?? ""));
	if (href != null && !/^javascript:/i.test(href)) {
		return resolveOptionalUrl(href, baseUrl);
	}

	const onclick = normalizeOptionalString(String($(element).attr("onclick") ?? ""));
	if (onclick == null) {
		return null;
	}

	const onclickTarget = extractOnclickNavigationTarget(onclick);
	return onclickTarget == null ? null : resolveOptionalUrl(onclickTarget, baseUrl);
}

export function extractOnclickNavigationTarget(onclick: string): string | null {
	const patterns = [
		/opennews\(\s*(['"])(?<url>.+?)\1\s*\)/i,
		/(?:window\.)?open\(\s*(['"])(?<url>.+?)\1/i,
		/(?:window\.)?location(?:\.href)?\s*=\s*(['"])(?<url>.+?)\1/i,
		/(?:window\.)?location\.(?:assign|replace)\(\s*(['"])(?<url>.+?)\1\s*\)/i,
	];

	for (const pattern of patterns) {
		const match = onclick.match(pattern);
		const candidate = match?.groups?.url;
		const normalized = normalizeOptionalString(candidate);
		if (normalized != null) {
			return normalized;
		}
	}

	return null;
}

export function getDomTagName(node: HtmlDomNode | undefined): string {
	if (node == null || !("tagName" in node)) {
		return "";
	}
	return String(node.tagName ?? "").toLowerCase();
}

export function stripKnownTrackingResidue(value: string): string {
	return value.replace(/_showDynClickBatch\s*\([^)]*\)/g, " ");
}

export function compactHeadingPath(value: Array<string | null | undefined>): string[] {
	return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function looksLikeDateText(text: string): boolean {
	return (
		/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text) ||
		/^\d{2}[-/.月]\d{2}/.test(text) ||
		/^(?:[一二三四五六七八九十]{1,3}|\d{1,2})月\s*\d{1,2}/.test(text)
	);
}

export function containsDateLikeText(text: string | null | undefined): boolean {
	if (text == null || text.length === 0) {
		return false;
	}

	return (
		/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}[-/.月]\d{1,2}/.test(text) ||
		/(?:[一二三四五六七八九十]{1,3}|\d{1,2})月\s*\d{1,2}/.test(text)
	);
}

export function isContactLikeText(text: string | null | undefined): boolean {
	if (text == null || text.length === 0) {
		return false;
	}

	return (
		/(电话|联系电话|传真|邮箱|电子邮箱|地址|邮编|办公室|办公电话|contact|e-?mail)/i.test(text) ||
		/010-\d{7,8}/.test(text) ||
		/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
	);
}

export function isShortDirectoryLinkText(text: string | null | undefined): boolean {
	const normalized = normalizeText(text);
	if (normalized == null) {
		return false;
	}

	return (
		normalized.length >= 2 &&
		normalized.length <= 8 &&
		!containsDateLikeText(normalized) &&
		!/\d/.test(normalized) &&
		!/^(查看详情|详情|更多|more|read more|learn more)\s*>?$/i.test(normalized.trim())
	);
}
