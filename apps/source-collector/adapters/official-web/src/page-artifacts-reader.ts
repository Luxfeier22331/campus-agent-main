import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { normalizeText } from "./page-artifacts-helpers.ts";
import type { ExtractedBlockCandidate } from "./page-artifacts-types.ts";

const READER_CHAR_THRESHOLD = 200;
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,dt,div";
const STRUCTURAL_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,dt";

export function extractReaderBlockCandidates(input: {
	responseBody: string;
	baseUrl: string;
}): ExtractedBlockCandidate[] {
	const dom = new JSDOM(input.responseBody, {
		contentType: "text/html",
		url: input.baseUrl,
	});
	const documentClone = dom.window.document.cloneNode(true) as Document;
	const article = new Readability(documentClone, {
		charThreshold: READER_CHAR_THRESHOLD,
	}).parse();
	if (!article?.content) {
		return [];
	}

	const articleDom = new JSDOM(article.content, {
		contentType: "text/html",
		url: input.baseUrl,
	});
	const document = articleDom.window.document;
	const candidates: ExtractedBlockCandidate[] = [];
	const headingPath: string[] = [];

	for (const element of Array.from(document.body.querySelectorAll(BLOCK_SELECTOR))) {
		if (shouldSkipContainerElement(element)) {
			continue;
		}
		const tagName = element.tagName.toLowerCase();
		const headingLevel = /^h\d$/.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null;
		const role =
			headingLevel == null
				? tagName === "li" || tagName === "dt"
					? "list_item"
					: "paragraph"
				: "heading";
		const segments = extractElementTextSegments(element);

		for (const textNormalized of segments) {
			if (textNormalized.length === 0) {
				continue;
			}
			const parentHeadingPath =
				headingLevel == null ? headingPath.filter((item) => item.length > 0) : [];

			candidates.push({
				blockRole: role,
				headingLevel,
				domPath: null,
				parentHeadingPath,
				listLevel: role === "list_item" ? 1 : null,
				tableId: null,
				tableRowIndex: null,
				tableColIndex: null,
				textRaw: textNormalized,
				textNormalized,
				htmlFragment: null,
				linkTarget: null,
				linkText: null,
				tableHtml: null,
				tableCells: null,
				isNavigation: false,
				isBoilerplate: false,
				isMainContent: true,
				mainContentScore: 0.9,
				titleCandidateScore: headingLevel === 1 ? 0.9 : 0,
				sectionHint: parentHeadingPath.at(-1) ?? (headingLevel == null ? null : textNormalized),
				classificationConfidence: 0.86,
				classificationReason: "readability_reader_content",
				parentHeadingHint: parentHeadingPath.at(-1) ?? null,
			});

			if (headingLevel != null) {
				headingPath.splice(headingLevel - 1);
				headingPath[headingLevel - 1] = textNormalized;
			}
		}
	}

	return candidates;
}

function shouldSkipContainerElement(element: Element): boolean {
	const tagName = element.tagName.toLowerCase();
	return (
		tagName === "div" &&
		!element.querySelector("br") &&
		element.querySelector(STRUCTURAL_BLOCK_SELECTOR) != null
	);
}

function extractElementTextSegments(element: Element): string[] {
	const clone = element.cloneNode(true) as Element;
	const document = clone.ownerDocument;
	if (document != null) {
		for (const br of Array.from(clone.querySelectorAll("br"))) {
			br.replaceWith(document.createTextNode("\n"));
		}
	}

	return (clone.textContent ?? "")
		.split("\n")
		.map((item) => normalizeText(item) ?? "")
		.filter((item) => item.length > 0);
}
