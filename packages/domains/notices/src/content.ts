import { JSDOM } from "jsdom";
import {
	cleanChildren,
	collectTextNodes,
	normalizeHeadingLevels,
	pruneEmptyElements,
	removeRepeatedTitle,
	trimBlockTextEdges,
} from "./content-cleanup.ts";
import {
	DUPLICATE_PUNCTUATION,
	LOGIN_CONTEXT,
	NOTICE_TEXT_REPLACEMENTS,
	SPACE_BEFORE_CJK_PUNCTUATION,
} from "./content-constants.ts";
import { deriveStructuredText } from "./content-text.ts";
import type { NormalizedNoticeContent } from "./content-types.ts";

export type {
	NormalizedNoticeContent,
	NoticeAssetKind,
	NoticeImageReference,
} from "./content-types.ts";

export function normalizeNoticeContent(input: {
	html: string | null;
	/** 门户已永久缺失的图片来源序号；正文去掉这些图片，展示序号保持连续。 */
	missingImageSourceOrdinals?: ReadonlySet<number>;
	portalHost: string;
	title: string;
}): NormalizedNoticeContent {
	if (input.html === null || !input.html.trim()) {
		return { contentHtml: null, contentText: null, images: [] };
	}
	const dom = new JSDOM(`<body>${input.html}</body>`);
	const { document, Node } = dom.window;
	const images: NormalizedNoticeContent["images"] = [];
	normalizeHeadingLevels(document.body, document);
	cleanChildren(document.body, {
		document,
		images,
		missingImageSourceOrdinals: input.missingImageSourceOrdinals ?? new Set(),
		portalHost: input.portalHost.toLowerCase(),
		sourceImageOrdinal: 0,
	});
	applyNoticeTextCorrections(document.body);
	trimBlockTextEdges(document.body);
	pruneEmptyElements(document.body);
	removeRepeatedTitle(document.body, input.title);
	pruneEmptyElements(document.body);
	const text = deriveStructuredText(document.body, Node);
	const hasStructuredContent = Boolean(text || document.body.querySelector("IMG, TABLE"));
	const html = hasStructuredContent ? document.body.innerHTML.trim() : "";
	return {
		contentHtml: html || null,
		contentText: text || null,
		images,
	};
}

function applyNoticeTextCorrections(root: Element): void {
	for (const textNode of collectTextNodes(root)) {
		let value = textNode.textContent ?? "";
		for (const [from, to] of NOTICE_TEXT_REPLACEMENTS) {
			value = value.replaceAll(from, to);
		}
		value = value
			.replace(LOGIN_CONTEXT, "登录")
			.replace(SPACE_BEFORE_CJK_PUNCTUATION, "$1")
			.replace(DUPLICATE_PUNCTUATION, "；");
		textNode.textContent = value;
	}
}
