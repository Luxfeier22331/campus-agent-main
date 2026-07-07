export type HtmlVisualReferencePattern =
	| "img_src"
	| "img_lazy_attr"
	| "img_srcset"
	| "source_srcset"
	| "style_url";

export type HtmlVisualReferenceSourceTag = "img" | "source" | "style";

export interface HtmlVisualReferenceCandidate {
	attributeName: string;
	linkText: string | null;
	pattern: HtmlVisualReferencePattern;
	rawUrl: string;
	sourceTag: HtmlVisualReferenceSourceTag;
}

const HTML_IMG_TAG_RE = /<img\b[^>]*>/gis;
const HTML_SOURCE_TAG_RE = /<source\b[^>]*>/gis;
const HTML_ATTR_RE = /\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const HTML_TAG_RE = /<[^>]+>/g;
const STYLE_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gis;
const IMAGE_LAZY_URL_ATTRIBUTES = [
	"data-src",
	"data-original",
	"data-original-src",
	"data-lazy-src",
	"data-url",
];
const IMAGE_SRCSET_ATTRIBUTES = ["srcset", "data-srcset", "data-lazy-srcset"];

export function collectHtmlVisualReferenceCandidates(
	htmlValue: string,
): HtmlVisualReferenceCandidate[] {
	const candidates: HtmlVisualReferenceCandidate[] = [];
	for (const match of htmlValue.matchAll(HTML_IMG_TAG_RE)) {
		candidates.push(...collectImageElementCandidates(String(match[0] || "")));
	}
	for (const match of htmlValue.matchAll(HTML_SOURCE_TAG_RE)) {
		candidates.push(...collectSourceElementCandidates(String(match[0] || "")));
	}
	for (const match of htmlValue.matchAll(HTML_TAG_RE)) {
		candidates.push(...collectStyleImageCandidates(String(match[0] || "")));
	}
	return candidates;
}

function collectImageElementCandidates(tag: string): HtmlVisualReferenceCandidate[] {
	const candidates: HtmlVisualReferenceCandidate[] = [];
	const linkText = htmlAttributeValue(tag, "alt") ?? htmlAttributeValue(tag, "title");
	const rawSrc = htmlAttributeValue(tag, "src");
	if (rawSrc) {
		candidates.push({
			attributeName: "src",
			linkText,
			pattern: "img_src",
			rawUrl: rawSrc,
			sourceTag: "img",
		});
	}
	for (const attributeName of IMAGE_LAZY_URL_ATTRIBUTES) {
		const rawUrl = htmlAttributeValue(tag, attributeName);
		if (rawUrl) {
			candidates.push({
				attributeName,
				linkText,
				pattern: "img_lazy_attr",
				rawUrl,
				sourceTag: "img",
			});
		}
	}
	for (const attributeName of IMAGE_SRCSET_ATTRIBUTES) {
		const rawSrcset = htmlAttributeValue(tag, attributeName);
		if (!rawSrcset) {
			continue;
		}
		for (const rawUrl of parseSrcsetUrls(rawSrcset)) {
			candidates.push({
				attributeName,
				linkText,
				pattern: "img_srcset",
				rawUrl,
				sourceTag: "img",
			});
		}
	}
	return candidates;
}

function collectSourceElementCandidates(tag: string): HtmlVisualReferenceCandidate[] {
	const candidates: HtmlVisualReferenceCandidate[] = [];
	for (const attributeName of IMAGE_SRCSET_ATTRIBUTES) {
		const rawSrcset = htmlAttributeValue(tag, attributeName);
		if (!rawSrcset) {
			continue;
		}
		for (const rawUrl of parseSrcsetUrls(rawSrcset)) {
			candidates.push({
				attributeName,
				linkText: htmlAttributeValue(tag, "title"),
				pattern: "source_srcset",
				rawUrl,
				sourceTag: "source",
			});
		}
	}
	return candidates;
}

function collectStyleImageCandidates(tag: string): HtmlVisualReferenceCandidate[] {
	const styleValue = htmlAttributeValue(tag, "style");
	if (!styleValue) {
		return [];
	}
	const candidates: HtmlVisualReferenceCandidate[] = [];
	for (const match of styleValue.matchAll(STYLE_URL_RE)) {
		const rawUrl = normalizeNullableText(String(match[1] ?? match[2] ?? match[3] ?? ""));
		if (!rawUrl) {
			continue;
		}
		candidates.push({
			attributeName: "style",
			linkText: htmlAttributeValue(tag, "aria-label") ?? htmlAttributeValue(tag, "title"),
			pattern: "style_url",
			rawUrl,
			sourceTag: "style",
		});
	}
	return candidates;
}

function htmlAttributeValue(tag: string, attributeName: string): string | null {
	const target = attributeName.toLowerCase();
	for (const match of tag.matchAll(HTML_ATTR_RE)) {
		if (String(match[1] || "").toLowerCase() !== target) {
			continue;
		}
		const value = normalizeNullableText(
			decodeHtmlAttribute(String(match[2] ?? match[3] ?? match[4] ?? "")),
		);
		if (value) {
			return value;
		}
	}
	return null;
}

function parseSrcsetUrls(value: string): string[] {
	const urls: string[] = [];
	for (const candidate of value.split(",")) {
		const rawUrl = normalizeNullableText(candidate.trim().split(/\s+/)[0] ?? "");
		if (rawUrl) {
			urls.push(rawUrl);
		}
	}
	return urls;
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function normalizeNullableText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}
