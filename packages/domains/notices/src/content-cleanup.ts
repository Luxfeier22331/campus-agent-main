import { NOTICE_CONTENT_MAX_CELL_SPAN } from "campus-contracts/notices";

import {
	ALLOWED_TAGS,
	INLINE_PRESENTATION_TAGS,
	PRUNABLE_TAGS,
	REPEATED_TITLE_TAGS,
	TEXT_EDGE_TAGS,
} from "./content-constants.ts";
import {
	isEditorPlaceholderImage,
	normalizeImageAlt,
	normalizePortalImageUrl,
	safeLink,
} from "./content-media.ts";
import {
	applyBlockPresentation,
	applyInlinePresentation,
	sourcePresentation,
	wrapNodes,
} from "./content-presentation.ts";
import { normalizeComparableText, normalizeInlineWhitespace } from "./content-text.ts";
import type { NoticeImageReference } from "./content-types.ts";

export function normalizeHeadingLevels(root: Element, document: Document): void {
	const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
	const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
	const minimumLevel = levels.length > 0 ? Math.min(...levels) : 1;
	for (const [index, heading] of headings.entries()) {
		const level = Math.min(6, 3 + (levels[index] as number) - minimumLevel);
		const replacement = document.createElement(`h${level}`);
		for (const attribute of [...heading.attributes]) {
			replacement.setAttribute(attribute.name, attribute.value);
		}
		replacement.append(...heading.childNodes);
		heading.replaceWith(replacement);
	}
}

export function cleanChildren(
	parent: Element,
	input: {
		document: Document;
		images: NoticeImageReference[];
		portalHost: string;
		sourceImageOrdinal: number;
	},
): void {
	for (const child of [...parent.childNodes]) {
		if (child.nodeType === child.COMMENT_NODE) {
			child.remove();
			continue;
		}
		if (child.nodeType === child.TEXT_NODE) {
			child.textContent = normalizeInlineWhitespace(child.textContent ?? "");
			continue;
		}
		if (child.nodeType !== child.ELEMENT_NODE) {
			child.remove();
			continue;
		}
		const element = child as Element;
		if (["IFRAME", "FORM", "SCRIPT", "STYLE"].includes(element.tagName)) {
			element.remove();
			continue;
		}

		const presentation = sourcePresentation(element);
		const originalAlt = element.getAttribute("alt");
		const originalColspan = element.getAttribute("colspan");
		const originalHeight = element.getAttribute("height");
		const originalHref = element.getAttribute("href");
		const originalRowspan = element.getAttribute("rowspan");
		const originalSrc = element.getAttribute("src");
		const originalWidth = element.getAttribute("width");
		const isFirstRow =
			element.tagName === "TR" &&
			(element.getAttribute("class") ?? "").split(/\s+/u).includes("firstRow");

		cleanChildren(element, input);
		if (!ALLOWED_TAGS.has(element.tagName)) {
			const replacement = INLINE_PRESENTATION_TAGS.has(element.tagName)
				? wrapNodes(input.document, [...element.childNodes], presentation)
				: [...element.childNodes];
			element.replaceWith(...replacement);
			continue;
		}

		for (const attribute of [...element.attributes]) {
			element.removeAttribute(attribute.name);
		}
		if (element.tagName === "A") {
			const href = safeLink(originalHref);
			if (!href) {
				element.replaceWith(...element.childNodes);
				continue;
			}
			element.setAttribute("href", href);
			element.setAttribute("rel", "noopener noreferrer");
		}
		if (element.tagName === "IMG") {
			const normalized = normalizePortalImageUrl(originalSrc, input.portalHost);
			if (!normalized) {
				element.remove();
				continue;
			}
			const sourceOrdinal = input.sourceImageOrdinal;
			input.sourceImageOrdinal += 1;
			if (isEditorPlaceholderImage(normalized, originalWidth, originalHeight)) {
				element.remove();
				continue;
			}
			const ordinal = input.images.length;
			input.images.push({
				normalizedUrl: normalized,
				ordinal,
				sourceOrdinal,
				sourceUrl: originalSrc ?? "",
			});
			element.setAttribute("src", `notice-asset:image:${ordinal}`);
			element.setAttribute("alt", normalizeImageAlt(originalAlt));
			continue;
		}
		if (element.tagName === "TD" || element.tagName === "TH") {
			setCellSpan(element, "colspan", originalColspan);
			setCellSpan(element, "rowspan", originalRowspan);
		}
		applyBlockPresentation(element, presentation);
		applyInlinePresentation(element, presentation, input.document);
		if (isFirstRow) {
			for (const cell of [...element.children]) {
				if (cell.tagName === "TD") {
					const header = input.document.createElement("th");
					for (const attribute of [...cell.attributes]) {
						header.setAttribute(attribute.name, attribute.value);
					}
					header.setAttribute("scope", "col");
					header.append(...cell.childNodes);
					cell.replaceWith(header);
				} else if (cell.tagName === "TH") {
					cell.setAttribute("scope", "col");
				}
			}
		}
	}
}

function setCellSpan(element: Element, name: "colspan" | "rowspan", value: string | null): void {
	if (!(value && /^[0-9]+$/u.test(value))) {
		return;
	}
	const span = Number(value);
	if (span >= 2 && span <= NOTICE_CONTENT_MAX_CELL_SPAN) {
		element.setAttribute(name, String(span));
	}
}

export function trimBlockTextEdges(root: Element): void {
	for (const element of [root, ...root.querySelectorAll("*")]) {
		if (element !== root && !TEXT_EDGE_TAGS.has(element.tagName)) {
			continue;
		}
		const textNodes = collectTextNodes(element);
		const first = textNodes[0];
		const last = textNodes.at(-1);
		if (first) {
			first.textContent = first.textContent?.replace(/^\s+/u, "") ?? "";
		}
		if (last) {
			last.textContent = last.textContent?.replace(/\s+$/u, "") ?? "";
		}
	}
}

export function collectTextNodes(root: Element): Text[] {
	const nodes: Text[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			nodes.push(node as Text);
			return;
		}
		for (const child of [...node.childNodes]) {
			visit(child);
		}
	};
	visit(root);
	return nodes;
}

export function pruneEmptyElements(parent: Element): void {
	for (const element of [...parent.children]) {
		pruneEmptyElements(element);
		if (
			PRUNABLE_TAGS.has(element.tagName) &&
			!normalizeComparableText(element.textContent ?? "") &&
			!element.querySelector("IMG, TABLE")
		) {
			element.remove();
		}
	}
}

export function removeRepeatedTitle(root: Element, title: string): void {
	const firstMeaningfulNode = [...root.childNodes].find(
		(node) =>
			node.nodeType !== node.TEXT_NODE || Boolean(normalizeComparableText(node.textContent ?? "")),
	);
	if (!firstMeaningfulNode || firstMeaningfulNode.nodeType !== firstMeaningfulNode.ELEMENT_NODE) {
		return;
	}
	const firstElement = firstMeaningfulNode as Element;
	if (
		!REPEATED_TITLE_TAGS.has(firstElement.tagName) ||
		firstElement.querySelector("A, IMG, OL, TABLE, UL")
	) {
		return;
	}
	const normalizedTitle = normalizeComparableText(title);
	const firstBreak = firstElement.querySelector("BR");
	if (firstBreak) {
		const range = firstElement.ownerDocument.createRange();
		range.selectNodeContents(firstElement);
		range.setEndBefore(firstBreak);
		if (normalizeComparableText(range.cloneContents().textContent ?? "") === normalizedTitle) {
			range.deleteContents();
			firstBreak.remove();
		}
		return;
	}
	if (normalizeComparableText(firstElement.textContent ?? "") === normalizedTitle) {
		firstElement.remove();
	}
}
