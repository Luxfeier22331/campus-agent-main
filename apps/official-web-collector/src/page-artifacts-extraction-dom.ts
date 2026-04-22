import type { HtmlDomApi, HtmlDomSelection } from "./page-artifacts-helpers.ts";
import {
	looksLikeDateText,
	normalizeOptionalString,
	normalizeText,
	stripKnownTrackingResidue,
} from "./page-artifacts-helpers.ts";

export function extractElementText($: HtmlDomApi, element: unknown): string | null {
	const tagName = String((element as { tagName?: unknown }).tagName ?? "").toLowerCase();
	if (tagName === "a") {
		const preferredStructuredText = resolvePreferredStructuredAnchorText($, element);
		if (preferredStructuredText != null) {
			return preferredStructuredText;
		}
	}

	const clone = $(element).clone();
	clone.find("script,style,noscript,template").remove();
	hydratePreferredAnchorTitleText($, clone);
	return normalizeOptionalString(stripKnownTrackingResidue(clone.text()));
}

export function extractElementHtmlFragment($: HtmlDomApi, element: unknown): string | null {
	const clone = $(element).clone();
	clone.find("script,style,noscript,template").remove();
	return normalizeOptionalString($.html(clone));
}

export function shouldSuppressVisuallyHiddenElement($: HtmlDomApi, element: unknown): boolean {
	const candidates = [element, ...($(element).parents().toArray() as unknown[])];
	return candidates.some(
		(candidate) =>
			isDirectlyVisuallyHiddenElement($, candidate) ||
			isSuppressedMediaOverlayElement($, candidate),
	);
}

export function resolvePreferredStructuredAnchorText(
	$: HtmlDomApi,
	element: unknown,
): string | null {
	const anchor = $(element);
	const structuredDescendants = anchor
		.find("h1,h2,h3,h4,h5,h6,p,span,time,strong,em")
		.toArray() as unknown[];
	if (structuredDescendants.length < 2 && !hasDateLikeDescendant($, element)) {
		return null;
	}

	const scoredCandidates = structuredDescendants
		.map((candidate, index) => {
			if ($(candidate).find("h1,h2,h3,h4,h5,h6,p,span,time,strong,em").length > 0) {
				return null;
			}

			const text = normalizeText(extractElementText($, candidate));
			if (text == null || looksLikeDateText(text) || isGenericDetailLinkText(text)) {
				return null;
			}

			const tagName = String((candidate as { tagName?: unknown }).tagName ?? "").toLowerCase();
			const classOrId =
				`${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`.toLowerCase();
			let score = 0;
			if (/^h\d$/.test(tagName)) {
				score += 6;
			}
			if (/(^|[\s_-])(title|tit|bt|name|subject|headline)([\s_-]|$)/.test(classOrId)) {
				score += 4;
			}
			if (/(^|[\s_-])(summary|excerpt|abstract|meta|date|time)([\s_-]|$)/.test(classOrId)) {
				score -= 3;
			}
			if (text.length >= 4 && text.length <= 64) {
				score += 2;
			} else if (text.length > 120) {
				score -= 2;
			}
			return { text, index, score };
		})
		.filter((item): item is { text: string; index: number; score: number } => item != null)
		.sort((left, right) => right.score - left.score || left.index - right.index);

	const best = scoredCandidates[0];
	return best != null && best.score > 0 ? best.text : null;
}

export function buildDomPath($: HtmlDomApi, element: unknown): string | null {
	const segments: string[] = [];
	let current = $(element);
	while (current.length > 0) {
		const tagName = String(current[0]?.tagName ?? "").toLowerCase();
		if (!tagName || tagName === "html") {
			break;
		}
		const parent = current.parent();
		const sameTagSiblings = parent.children(tagName);
		const index =
			sameTagSiblings.toArray().findIndex((candidate: unknown) => candidate === current[0]) + 1;
		segments.unshift(`${tagName}[${index}]`);
		current = parent;
	}
	return segments.length > 0 ? segments.join(" > ") : null;
}

export function hasTagAncestor($: HtmlDomApi, element: unknown, tagName: string): boolean {
	return $(element).parents(tagName).length > 0;
}

export function hasMainContentAncestorCue($: HtmlDomApi, element: unknown): boolean {
	if (hasTagAncestor($, element, "main") || hasTagAncestor($, element, "article")) {
		return true;
	}

	const candidates = [element, ...($(element).parents().toArray() as unknown[])];
	return candidates.some((candidate) => {
		if (
			hasNavigationAncestor($, candidate) ||
			hasBoilerplateRegionAncestor($, candidate) ||
			hasTagAncestor($, candidate, "header") ||
			hasTagAncestor($, candidate, "footer") ||
			hasTagAncestor($, candidate, "aside")
		) {
			return false;
		}

		const classOrId =
			`${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`.toLowerCase();
		return /(^|[\s_-])(vsb[_-]?content|main[_-]?content|content[_-]?main|article[_-]?content|post[_-]?content|detail[_-]?content|text[_-]?list|list[_-]?content|list[_-]?right|right[_-]?con|ny[_-]?right|wape[_-]?right|callboard|callboard[_-]?body|publishment|cic[_-]?main|content[_-]?body|content[_-]?detail|contentbox|content[_-]?box|con[_-]?box|cont[_-]?box|nr[_-]?box|xl[_-]?content)([\s_-]|$)/.test(
			classOrId,
		);
	});
}

export function hasNavigationAncestor($: HtmlDomApi, element: unknown): boolean {
	if ($(element).parents("nav,header,footer").length > 0) {
		return true;
	}

	const classOrId = [
		$(element).attr("class"),
		$(element).attr("id"),
		$(element)
			.parents()
			.map(
				(_index: number, parent: unknown) =>
					`${$(parent).attr("class") ?? ""} ${$(parent).attr("id") ?? ""}`,
			)
			.get()
			.join(" "),
	]
		.filter((item): item is string => typeof item === "string")
		.join(" ")
		.toLowerCase();

	const hasPositionContentCue = /position[_-]{1,2}content/.test(classOrId);
	const hasNavigationKeyword =
		/(^|[\s_-])(nav|menu|breadcrumb|footer|header|crumb|bar|dhbar|posi)([\s_-]|$)/.test(classOrId);
	const hasBreadcrumbPositionKeyword =
		!hasPositionContentCue && /(^|[\s_-])position([\s_-]|$)/.test(classOrId);

	return hasNavigationKeyword || hasBreadcrumbPositionKeyword;
}

export function hasBoilerplateRegionAncestor($: HtmlDomApi, element: unknown): boolean {
	if ($(element).parents("aside").length > 0) {
		return true;
	}

	const classOrId = [
		$(element).attr("class"),
		$(element).attr("id"),
		$(element)
			.parents()
			.map(
				(_index: number, parent: unknown) =>
					`${$(parent).attr("class") ?? ""} ${$(parent).attr("id") ?? ""}`,
			)
			.get()
			.join(" "),
	]
		.filter((item): item is string => typeof item === "string")
		.join(" ")
		.toLowerCase();

	return /(^|[\s_-])(sidebar|side-bar|sidepanel|side-panel|share|social|qrcode|qr-code)([\s_-]|$)/.test(
		classOrId,
	);
}

export function extractTableCells($: HtmlDomApi, element: unknown): string[][] {
	return $(element)
		.find("tr")
		.toArray()
		.map((row: unknown) =>
			$(row)
				.find("th,td")
				.toArray()
				.map((cell: unknown) => normalizeText($(cell).text()) ?? ""),
		);
}

export function hasDateLikeDescendant($: HtmlDomApi, element: unknown): boolean {
	const descendants = $(element).find("time,span").toArray() as unknown[];
	return descendants.some((candidate) => {
		const text = normalizeText($(candidate).text());
		if (text == null) {
			return false;
		}
		return looksLikeDateText(text);
	});
}

export function hasDirectoryRosterContext($: HtmlDomApi, element: unknown): boolean {
	const listItem = $(element).closest("li,dt");
	if (listItem.length === 0) {
		return false;
	}

	const contextFragments = [
		listItem.parent().prevAll().slice(0, 3).text(),
		listItem
			.parents("section,div,main,article")
			.slice(0, 4)
			.map((_index: number, candidate: unknown) => {
				const anchorText = $(candidate)
					.children(
						"h1,h2,h3,h4,h5,h6,.list-right-l,.list-right-tt,.teacher-title,.directory-title",
					)
					.first()
					.text();
				const previousText = $(candidate).prevAll().slice(0, 2).text();
				return `${anchorText} ${previousText}`;
			})
			.get()
			.join(" "),
	];
	const contextText = normalizeText(contextFragments.join(" "));
	if (contextText == null) {
		return false;
	}

	return /(师资|教师|教授|导师|学系|法学系|队伍|名录|faculty|staff|directory|roster)/i.test(
		contextText,
	);
}

export function hasCardLikeStructure($: HtmlDomApi, element: unknown): boolean {
	const candidate = $(element);
	if (candidate.find("img,picture,video,svg").length > 0) {
		return true;
	}

	const classOrId = [
		candidate.attr("class"),
		candidate.attr("id"),
		candidate
			.find("*")
			.map(
				(_index: number, child: unknown) =>
					`${$(child).attr("class") ?? ""} ${$(child).attr("id") ?? ""}`,
			)
			.get()
			.join(" "),
	]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();

	return /(card|news|video|thumb|pic|image|media|mask|swiper|slide|cover|txt|summary|excerpt|teaser)/.test(
		classOrId,
	);
}

export function isGenericDetailLinkText(text: string): boolean {
	return /^(查看详情|详情|更多|more|read more|learn more)\s*>?$/i.test(text.trim());
}

function hydratePreferredAnchorTitleText($: HtmlDomApi, root: HtmlDomSelection): void {
	const anchors = [
		...(root.is("a[title]") ? [root[0]] : []),
		...(root.find("a[title]").toArray() as unknown[]),
	];

	for (const anchorElement of anchors) {
		const anchor = $(anchorElement);
		const preferredTitleText = resolvePreferredAnchorTitleText($, anchor);
		if (preferredTitleText == null) {
			continue;
		}

		anchor.contents().each((_index: number, child: unknown) => {
			if (String((child as { type?: unknown }).type ?? "") === "text") {
				$(child).remove();
			}
		});
		anchor.prepend(`${preferredTitleText} `);
	}
}

function resolvePreferredAnchorTitleText(_$: HtmlDomApi, anchor: HtmlDomSelection): string | null {
	const titleText = normalizeText(String(anchor.attr("title") ?? ""));
	if (titleText == null) {
		return null;
	}

	const directVisibleText = normalizeText(
		(anchor.contents().toArray() as unknown[])
			.filter((child) => String((child as { type?: unknown }).type ?? "") === "text")
			.map((child) => String((child as { data?: unknown }).data ?? ""))
			.join(" "),
	);
	if (directVisibleText == null) {
		return titleText;
	}

	if (directVisibleText === titleText) {
		return null;
	}

	if (/[.…]{1,3}$/.test(directVisibleText)) {
		return titleText;
	}

	if (titleText.startsWith(directVisibleText) && titleText.length > directVisibleText.length) {
		return titleText;
	}

	return null;
}

function isDirectlyVisuallyHiddenElement($: HtmlDomApi, element: unknown): boolean {
	const candidate = $(element);
	if (candidate.attr("hidden") != null) {
		return true;
	}

	if (String(candidate.attr("aria-hidden") ?? "").toLowerCase() === "true") {
		return true;
	}

	const normalizedStyle = String(candidate.attr("style") ?? "")
		.toLowerCase()
		.replace(/\s+/g, "");

	if (normalizedStyle.includes("display:none") || normalizedStyle.includes("visibility:hidden")) {
		return true;
	}

	const hidesOverflowText =
		normalizedStyle.includes("overflow:hidden") &&
		(normalizedStyle.includes("height:0") ||
			normalizedStyle.includes("height:0px") ||
			/font-size:(0|1px)(;|$)/.test(normalizedStyle));

	return hidesOverflowText;
}

function isSuppressedMediaOverlayElement($: HtmlDomApi, element: unknown): boolean {
	return $(element).is(
		"#audioDiv, #videoDiv, .grid-music-container, .grid-video-container, .m-music-lyric-wrap, .js-music-lyric-content",
	);
}
