import type { CheerioCrawlingContext } from "crawlee";
import type { OfficialWebContentBlockRow } from "./official-web-core.ts";
import {
	buildDomPath,
	extractElementHtmlFragment,
	extractElementText,
	hasBoilerplateRegionAncestor,
	hasNavigationAncestor,
	hasTagAncestor,
	shouldSuppressVisuallyHiddenElement,
} from "./page-artifacts-extraction-dom.ts";
import {
	analyzeVisibleContentContainers,
	isListingLikeRecoveryContainer,
	selectRecoverableContentContainers,
} from "./page-artifacts-extraction-recovery-containers.ts";
import {
	containsDateLikeText,
	getDomTagName,
	type HtmlDomApi,
	type HtmlDomNode,
	normalizePageTitle,
	normalizeText,
	resolveAnchorTargetUrl,
} from "./page-artifacts-helpers.ts";
import type {
	ExtractedBlockCandidate,
	VisibleContentContainerStats,
} from "./page-artifacts-types.ts";

export function extractRecoveryBlockCandidates(input: {
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	siteDisplayName: string;
}): ExtractedBlockCandidate[] {
	const $: HtmlDomApi = input.html;
	const containers = selectRecoverableContentContainers(
		$,
		analyzeVisibleContentContainers(input.html),
	);
	if (containers.length === 0) {
		return [];
	}

	const candidates: ExtractedBlockCandidate[] = [];
	const seenDomPaths = new Set<string>();

	for (const container of containers) {
		const directTextBlocks = extractDirectTextRecoveryBlocks($, container);
		for (const block of directTextBlocks) {
			candidates.push(block);
		}

		const selector = isListingLikeRecoveryContainer(container)
			? "a,div,span,time"
			: "h1,h2,h3,h4,h5,h6,p,li,dt,dd,div,section,article,span,time,a";
		const elements = $(container.element).find(selector).toArray() as HtmlDomNode[];

		for (const element of elements) {
			const tagName = getDomTagName(element);
			if (tagName.length === 0 || shouldSuppressVisuallyHiddenElement($, element)) {
				continue;
			}

			const domPath = buildDomPath($, element);
			if (domPath == null || seenDomPaths.has(domPath)) {
				continue;
			}

			const textRaw = extractElementText($, element);
			if (textRaw == null || !shouldRecoverElement($, element, tagName, container, input.baseUrl)) {
				continue;
			}

			const textNormalized =
				tagName === "title"
					? normalizePageTitle(textRaw, input.siteDisplayName)
					: normalizeText(textRaw);
			if (textNormalized == null) {
				continue;
			}

			seenDomPaths.add(domPath);
			candidates.push({
				blockRole: resolveRecoveryBlockRole(tagName),
				headingLevel: /^h\d$/.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null,
				domPath,
				parentHeadingPath: [],
				listLevel:
					tagName === "li"
						? $(element).parents("ul,ol").length
						: tagName === "dt" || tagName === "dd"
							? $(element).parents("dl").length
							: null,
				tableId: null,
				tableRowIndex: null,
				tableColIndex: null,
				textRaw,
				textNormalized,
				htmlFragment: extractElementHtmlFragment($, element),
				linkTarget: tagName === "a" ? resolveAnchorTargetUrl($, element, input.baseUrl) : null,
				linkText: tagName === "a" ? textNormalized : null,
				tableHtml: null,
				tableCells: null,
				isNavigation: false,
				isBoilerplate: false,
				isMainContent: true,
				mainContentScore: 0.88,
				titleCandidateScore: /^h1$/.test(tagName) ? 1 : 0,
				sectionHint: null,
				classificationConfidence: 0.82,
				classificationReason: "visible_content_recovery",
				parentHeadingHint: null,
			});
		}
	}

	return candidates;
}

function extractDirectTextRecoveryBlocks(
	$: HtmlDomApi,
	container: VisibleContentContainerStats,
): ExtractedBlockCandidate[] {
	if (isListingLikeRecoveryContainer(container)) {
		return [];
	}

	const parts = splitContainerDirectText($, container.element);
	return parts.map((text, index) => ({
		blockRole: "paragraph",
		headingLevel: null,
		domPath: `${buildDomPath($, container.element) ?? "container"}::text[${index + 1}]`,
		parentHeadingPath: [],
		listLevel: null,
		tableId: null,
		tableRowIndex: null,
		tableColIndex: null,
		textRaw: text,
		textNormalized: text,
		htmlFragment: null,
		linkTarget: null,
		linkText: null,
		tableHtml: null,
		tableCells: null,
		isNavigation: false,
		isBoilerplate: false,
		isMainContent: true,
		mainContentScore: 0.88,
		titleCandidateScore: 0,
		sectionHint: null,
		classificationConfidence: 0.82,
		classificationReason: "visible_content_recovery",
		parentHeadingHint: null,
	}));
}

function splitContainerDirectText($: HtmlDomApi, element: HtmlDomNode): string[] {
	const parts: string[] = [];
	let buffer: string[] = [];

	const flush = () => {
		const text = normalizeText(buffer.join(" "));
		buffer = [];
		if (text != null && text.length >= 4) {
			parts.push(text);
		}
	};

	for (const child of $(element).contents().toArray() as HtmlDomNode[]) {
		const nodeType = String((child as { type?: unknown }).type ?? "");
		if (nodeType === "text") {
			buffer.push(String((child as { data?: unknown }).data ?? ""));
			continue;
		}
		if (getDomTagName(child) === "br") {
			flush();
			continue;
		}
		flush();
	}
	flush();
	return parts;
}

export function looksLikeDynamicShell(responseBody: string): boolean {
	const normalized = responseBody.toLowerCase();
	const scriptCount = (normalized.match(/<script\b/g) ?? []).length;
	const hasMountNode =
		/id=["'](app|root|__next|nuxt)["']/.test(normalized) || /data-v-app/.test(normalized);
	const hasClientFetchSignal =
		/(fetch\(|axios|xmlhttprequest|reactdom|createapp\(|window\.__|jsonp|\.load\()/i.test(
			responseBody,
		);

	return scriptCount >= 1 && (hasMountNode || hasClientFetchSignal);
}

export function looksLikeStructuralShell(html: CheerioCrawlingContext["$"]): boolean {
	const containers = analyzeVisibleContentContainers(html);
	if (containers.length === 0) {
		return false;
	}

	const maxTextLength = containers.reduce((max, item) => Math.max(max, item.textLength), 0);
	const hasStructuredShellCue = containers.some(
		(item) =>
			item.mediaCount > 0 || item.listCount > 0 || item.hasPagination || containers.length >= 2,
	);

	return maxTextLength <= 24 && hasStructuredShellCue;
}

function shouldRecoverElement(
	$: HtmlDomApi,
	element: HtmlDomNode,
	tagName: string,
	container: VisibleContentContainerStats,
	baseUrl: string,
): boolean {
	const textNormalized = normalizeText(extractElementText($, element));
	if (textNormalized == null) {
		return false;
	}

	if (
		hasNavigationAncestor($, element) ||
		hasBoilerplateRegionAncestor($, element) ||
		hasTagAncestor($, element, "footer")
	) {
		return false;
	}

	if (tagName === "a") {
		return resolveAnchorTargetUrl($, element, baseUrl) != null;
	}

	if (tagName === "li" || tagName === "dt" || tagName === "dd") {
		return textNormalized.length >= 8 || containsDateLikeText(textNormalized);
	}

	if (/^h\d$/.test(tagName) || tagName === "p") {
		return textNormalized.length >= 8;
	}

	if (tagName === "div" || tagName === "section" || tagName === "article") {
		if (isListingLikeRecoveryContainer(container)) {
			if (!containsDateLikeText(textNormalized) || textNormalized.length > 24) {
				return false;
			}

			return $(element)
				.children("div,section,article,span,time,p")
				.toArray()
				.every((candidate: HtmlDomNode) => {
					const childText = normalizeText(extractElementText($, candidate));
					return childText == null || !containsDateLikeText(childText);
				});
		}

		if (textNormalized.length < 24 || $(element).find("table").length > 0) {
			return false;
		}

		const hasSubstantialStructuredChild = $(element)
			.children("div,section,article,p,ul,ol,dl")
			.toArray()
			.some((candidate: HtmlDomNode) => {
				const childText = normalizeText(extractElementText($, candidate));
				return childText != null && childText.length >= 24;
			});

		return !hasSubstantialStructuredChild;
	}

	if (tagName === "span" || tagName === "time") {
		return containsDateLikeText(textNormalized);
	}

	return false;
}

function resolveRecoveryBlockRole(tagName: string): OfficialWebContentBlockRow["blockRole"] {
	if (/^h\d$/.test(tagName)) {
		return "heading";
	}
	if (tagName === "a") {
		return "link";
	}
	if (tagName === "li" || tagName === "dt" || tagName === "dd") {
		return "list_item";
	}
	return "paragraph";
}
