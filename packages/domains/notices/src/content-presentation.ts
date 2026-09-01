import type { NOTICE_CONTENT_ALIGNMENTS } from "campus-contracts/notices";

import {
	ALERT_COLORS,
	ALIGNABLE_TAGS,
	ALIGNMENTS,
	HIGHLIGHT_COLORS,
	INLINE_PRESENTATION_TAGS,
} from "./content-constants.ts";
import { compactCssValue } from "./content-text.ts";
import type { NoticeSourcePresentation } from "./content-types.ts";

export function sourcePresentation(element: Element): NoticeSourcePresentation {
	const style = (element as HTMLElement).style;
	const color = compactCssValue(style.color || element.getAttribute("color") || "");
	const background = compactCssValue(style.backgroundColor || style.background || "");
	const fontWeight = compactCssValue(style.fontWeight);
	const textDecoration = compactCssValue(style.textDecorationLine || style.textDecoration);
	const explicitAlignment = normalizeAlignment(style.textAlign || element.getAttribute("align"));
	const indent = normalizeIndent(style.textIndent);
	return {
		alert: ALERT_COLORS.has(color),
		align:
			explicitAlignment === "center" || explicitAlignment === "end"
				? explicitAlignment
				: indent === "wide"
					? "end"
					: explicitAlignment,
		bold: fontWeight === "bold" || (Number(fontWeight) >= 600 && Number(fontWeight) <= 1000),
		highlight: HIGHLIGHT_COLORS.has(background),
		indent: indent === "first-line",
		underline: textDecoration.includes("underline"),
	};
}

export function applyBlockPresentation(
	element: Element,
	presentation: NoticeSourcePresentation,
): void {
	if (ALIGNABLE_TAGS.has(element.tagName) && presentation.align) {
		element.setAttribute("data-align", presentation.align);
	}
	if (
		element.tagName === "P" &&
		presentation.indent &&
		presentation.align !== "center" &&
		presentation.align !== "end"
	) {
		element.setAttribute("data-indent", "true");
	}
}

export function applyInlinePresentation(
	element: Element,
	presentation: NoticeSourcePresentation,
	document: Document,
): void {
	if (!INLINE_PRESENTATION_TAGS.has(element.tagName)) {
		return;
	}
	const remaining = { ...presentation };
	if (element.tagName === "STRONG") {
		remaining.bold = false;
		if (remaining.alert) {
			element.setAttribute("data-emphasis", "alert");
			remaining.alert = false;
		}
	} else if (element.tagName === "B") {
		remaining.bold = false;
	}
	if (element.tagName === "U") {
		remaining.underline = false;
	}
	if (element.tagName === "MARK") {
		remaining.highlight = false;
	}
	const wrapped = wrapNodes(document, [...element.childNodes], remaining);
	if (
		wrapped.length !== element.childNodes.length ||
		wrapped.some((node, index) => node !== element.childNodes[index])
	) {
		element.replaceChildren(...wrapped);
	}
}

export function wrapNodes(
	document: Document,
	nodes: Node[],
	presentation: NoticeSourcePresentation,
): Node[] {
	let wrapped = nodes;
	if (presentation.bold || presentation.alert) {
		const strong = document.createElement("strong");
		if (presentation.alert) {
			strong.setAttribute("data-emphasis", "alert");
		}
		strong.append(...wrapped);
		wrapped = [strong];
	}
	if (presentation.underline) {
		const underline = document.createElement("u");
		underline.append(...wrapped);
		wrapped = [underline];
	}
	if (presentation.highlight) {
		const mark = document.createElement("mark");
		mark.append(...wrapped);
		wrapped = [mark];
	}
	return wrapped;
}

function normalizeAlignment(value: string | null): NoticeSourcePresentation["align"] {
	const normalized = compactCssValue(value ?? "").replace(/!important$/u, "");
	const mapped =
		normalized === "right" ? "end" : normalized === "-webkit-center" ? "center" : normalized;
	return ALIGNMENTS.has(mapped) ? (mapped as (typeof NOTICE_CONTENT_ALIGNMENTS)[number]) : null;
}

function normalizeIndent(value: string): "first-line" | "none" | "wide" {
	const normalized = value.trim();
	const match = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))(em|px|rem)?$/iu.exec(normalized);
	if (!match) {
		return "none";
	}
	const amount = Number(match[1]);
	if (amount <= 0) {
		return "none";
	}
	const unit = match[2]?.toLowerCase();
	if ((unit === "px" && amount >= 135) || ((unit === "em" || unit === "rem") && amount >= 6)) {
		return "wide";
	}
	return "first-line";
}
