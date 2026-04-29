import type { OfficialWebContentBlockRow } from "./official-web-core.ts";
import {
	extractElementText,
	hasCardLikeStructure,
	hasDateLikeDescendant,
	hasDirectoryRosterContext,
	hasMainContentAncestorCue,
	resolvePreferredStructuredAnchorText,
} from "./page-artifacts-extraction-dom.ts";
import type { HtmlDomApi } from "./page-artifacts-helpers.ts";
import {
	extractOnclickNavigationTarget,
	getDomTagName,
	type HtmlDomNode,
	looksLikeDateText,
	normalizeOptionalString,
	normalizeText,
} from "./page-artifacts-helpers.ts";

export function resolveBlockRole(
	tagName: string,
	isNavigation: boolean,
	isFooter: boolean,
): OfficialWebContentBlockRow["blockRole"] {
	if (tagName === "title") {
		return "title";
	}
	if (/^h\d$/.test(tagName)) {
		return "heading";
	}
	if (tagName === "p") {
		return isFooter ? "footer" : "paragraph";
	}
	if (tagName === "li" || tagName === "dt") {
		return "list_item";
	}
	if (tagName === "table") {
		return "table";
	}
	if (tagName === "a") {
		return isNavigation ? "link" : "link";
	}
	return "metadata";
}

export function shouldSuppressAggregateListItem($: HtmlDomApi, element: HtmlDomNode): boolean {
	const candidate = $(element);
	const anchorCount = candidate.find("a").length;
	if (anchorCount === 0) {
		return false;
	}

	const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
	if (structuredDescendantCount === 0) {
		return false;
	}

	return (
		structuredDescendantCount >= 2 ||
		candidate.find("h1,h2,h3,h4,h5,h6,time").length > 0 ||
		hasCardLikeStructure($, element)
	);
}

export function shouldSuppressAggregateTable($: HtmlDomApi, element: HtmlDomNode): boolean {
	const textNormalized = normalizeText(extractElementText($, element));
	if (textNormalized == null) {
		return true;
	}

	const ancestorTables = $(element).parents("table").toArray() as HtmlDomNode[];
	return ancestorTables.some(
		(candidate) => normalizeText(extractElementText($, candidate)) === textNormalized,
	);
}

export function isLikelyNavigationalListItem(
	$: HtmlDomApi,
	element: HtmlDomNode,
	hasMainContentAncestor: boolean,
): boolean {
	if (hasMainContentAncestor || hasDirectoryRosterContext($, element)) {
		return false;
	}

	const candidate = $(element);
	const textNormalized = normalizeText(extractElementText($, element));
	if (textNormalized == null) {
		return false;
	}

	const anchorCount = candidate.find("a").length;
	if (anchorCount === 0) {
		return false;
	}

	const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
	if (structuredDescendantCount > 0 || hasDateLikeDescendant($, element)) {
		return false;
	}

	const siblingCount = candidate.parent().children("li").length;
	const linkText = normalizeText(
		candidate
			.find("a")
			.toArray()
			.map((anchor: HtmlDomNode) => extractElementText($, anchor) ?? "")
			.join(" "),
	);
	const linkDensity = computeTextDensity(linkText, textNormalized);
	return siblingCount >= 2 && linkDensity >= 0.75;
}

export function isLikelyMainContentListItem(
	$: HtmlDomApi,
	element: HtmlDomNode,
	hasMainContentAncestor: boolean,
): boolean {
	if (hasMainContentAncestor || hasDirectoryRosterContext($, element)) {
		return true;
	}

	const candidate = $(element);
	const anchorCount = candidate.find("a").length;
	if (anchorCount === 0) {
		return true;
	}

	const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
	if (structuredDescendantCount > 0 || hasDateLikeDescendant($, element)) {
		return true;
	}

	const textNormalized = normalizeText(extractElementText($, element));
	if (textNormalized == null) {
		return false;
	}

	const linkText = normalizeText(
		candidate
			.find("a")
			.toArray()
			.map((anchor: HtmlDomNode) => extractElementText($, anchor) ?? "")
			.join(" "),
	);
	return computeTextDensity(linkText, textNormalized) < 0.75;
}

export function isLikelyMainContentAnchor(
	$: HtmlDomApi,
	element: HtmlDomNode,
	hasMainContentAncestor: boolean,
	_baseUrl: string,
): boolean {
	const href = normalizeOptionalString(String($(element).attr("href") ?? "").trim());
	const onclick = normalizeOptionalString(String($(element).attr("onclick") ?? ""));
	const onclickTarget = onclick == null ? null : extractOnclickNavigationTarget(onclick);

	if (href != null && /^javascript:/i.test(href) && onclickTarget == null) {
		return false;
	}

	if (hasMainContentAncestor) {
		return true;
	}

	const closestTable = $(element).closest("table");
	if (closestTable.length > 0) {
		const tableElement = closestTable[0];
		const tableHasMainContentAncestor = hasMainContentAncestorCue($, tableElement);
		return (
			isLikelyGalleryTable($, tableElement) ||
			isLikelyListingTable($, tableElement) ||
			isLikelyMainContentTable($, tableElement, tableHasMainContentAncestor)
		);
	}

	const parentTagName = getDomTagName($(element).parent()[0]);
	if (/^h\d$/.test(parentTagName) || parentTagName === "p") {
		return true;
	}

	const closestListItem = $(element).closest("li,dt");
	if (closestListItem.length > 0) {
		if (shouldSuppressDatedListChildAnchor($, closestListItem[0])) {
			return false;
		}
		return !isLikelyNavigationalListItem(
			$,
			closestListItem[0],
			hasMainContentAncestorCue($, closestListItem[0]),
		);
	}

	return false;
}

export function shouldDemoteAggregateAnchorTitleDescendant(
	$: HtmlDomApi,
	element: HtmlDomNode,
	tagName: string,
	textNormalized: string | null,
): boolean {
	if (textNormalized == null || (!/^h\d$/.test(tagName) && tagName !== "p")) {
		return false;
	}

	const closestAnchor = $(element).closest("a");
	if (closestAnchor.length === 0 || closestAnchor[0] === element) {
		return false;
	}

	const preferredAnchorText = resolvePreferredStructuredAnchorText($, closestAnchor[0]);
	if (preferredAnchorText == null || preferredAnchorText !== textNormalized) {
		return false;
	}

	return (
		hasDateLikeDescendant($, closestAnchor[0]) ||
		closestAnchor.find("h1,h2,h3,h4,h5,h6,p").length >= 2
	);
}

export function hasNavigationalListContext(
	$: HtmlDomApi,
	element: HtmlDomNode,
	hasMainContentAncestor: boolean,
): boolean {
	const closestListItem = $(element).closest("li,dt");
	if (closestListItem.length === 0) {
		return false;
	}

	return isLikelyNavigationalListItem(
		$,
		closestListItem[0],
		hasMainContentAncestor || hasMainContentAncestorCue($, closestListItem[0]),
	);
}

export function isLikelyMainContentTable(
	$: HtmlDomApi,
	element: HtmlDomNode,
	hasMainContentAncestor: boolean,
): boolean {
	const maxColumnCount = $(element)
		.find("tr")
		.toArray()
		.reduce((max: number, row: HtmlDomNode) => Math.max(max, $(row).find("th,td").length), 0);

	if (hasMainContentAncestor && maxColumnCount >= 3) {
		return true;
	}

	if (isLikelyListingTable($, element) || isLikelyGalleryTable($, element)) {
		return false;
	}

	if (hasMainContentAncestor) {
		return true;
	}

	return normalizeText(extractElementText($, element)) != null;
}

export function shouldUpdateHeadingPath(
	$: HtmlDomApi,
	element: HtmlDomNode,
	isBoilerplate: boolean,
): boolean {
	if (isBoilerplate) {
		return false;
	}

	const anchors = $(element).find("a[href]").toArray() as HtmlDomNode[];
	if (anchors.length !== 1) {
		return true;
	}

	const headingText = normalizeText(extractElementText($, element));
	const anchorText = normalizeText(extractElementText($, anchors[0]));
	if (headingText == null || anchorText == null || headingText !== anchorText) {
		return true;
	}

	const href = normalizeOptionalString($(anchors[0]).attr("href"));
	if (href == null) {
		return true;
	}

	return href.startsWith("#") || href.startsWith("javascript:");
}

function shouldSuppressDatedListChildAnchor($: HtmlDomApi, listItem: HtmlDomNode): boolean {
	return $(listItem).find("a").length === 1 && hasDateLikeDescendant($, listItem);
}

function isLikelyListingTable($: HtmlDomApi, element: HtmlDomNode): boolean {
	const table = $(element);
	const rowElements = table.find("tr").toArray() as HtmlDomNode[];
	const linkedRowCount = rowElements.filter((row) => tableRowContainsLinks($, row)).length;
	if (linkedRowCount < 2) {
		return false;
	}

	const classOrId = [table.attr("class"), table.attr("id")]
		.filter((item): item is string => typeof item === "string")
		.join(" ")
		.toLowerCase();
	if (
		/(^|[\s_-])((main|news|notice|bulletin|article|content)[\s_-]*)?list(table)?([\s_-]|$)/.test(
			classOrId,
		)
	) {
		return true;
	}

	const headerText = normalizeText(
		rowElements
			.flatMap((row) => $(row).find("th").toArray() as HtmlDomNode[])
			.map((cell) => $(cell).text())
			.join(" "),
	);
	if (
		headerText != null &&
		/(标题|题名)/.test(headerText) &&
		/(时间|日期|发布时间)/.test(headerText)
	) {
		return true;
	}

	const dateLikeCellCount = table
		.find("th,td")
		.toArray()
		.filter((cell: HtmlDomNode) => {
			const text = normalizeText($(cell).text());
			return text != null && looksLikeDateText(text);
		}).length;

	return dateLikeCellCount >= Math.min(linkedRowCount, 2);
}

function isLikelyGalleryTable($: HtmlDomApi, element: HtmlDomNode): boolean {
	const table = $(element);
	const anchorCount = table.find("a[href]").length;
	if (
		anchorCount < 2 ||
		table.find("img,picture,svg").length === 0 ||
		table.find("th").length > 0
	) {
		return false;
	}

	const dateLikeCellCount = table
		.find("td,span,time")
		.toArray()
		.filter((candidate: HtmlDomNode) => {
			const text = normalizeText($(candidate).text());
			return text != null && looksLikeDateText(text);
		}).length;

	return dateLikeCellCount === 0;
}

function computeTextDensity(segment: string | null, whole: string): number {
	if (segment == null || segment.length === 0 || whole.length === 0) {
		return 0;
	}
	return segment.length / whole.length;
}

function tableRowContainsLinks($: HtmlDomApi, row: HtmlDomNode): boolean {
	return $(row).find("a[href]").length > 0;
}
