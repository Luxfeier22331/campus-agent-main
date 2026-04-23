import type { CheerioCrawlingContext } from "crawlee";
import {
	admitOfficialWebUrl,
	buildOfficialWebDiscoveredLinkRecord,
	type OfficialWebConfigBundle,
	type OfficialWebDiscoveredLinkRecord,
	type OfficialWebHostPolicy,
} from "./official-web-core.ts";
import {
	hasNavigationalListContext,
	isLikelyMainContentAnchor,
	isLikelyMainContentListItem,
	isLikelyMainContentTable,
	isLikelyNavigationalListItem,
	resolveBlockRole,
	shouldDemoteAggregateAnchorTitleDescendant,
	shouldSuppressAggregateListItem,
	shouldSuppressAggregateTable,
	shouldUpdateHeadingPath,
} from "./page-artifacts-extraction-classification.ts";
import {
	buildDomPath,
	extractElementHtmlFragment,
	extractElementText,
	extractTableCells,
	hasBoilerplateRegionAncestor,
	hasMainContentAncestorCue,
	hasNavigationAncestor,
	hasTagAncestor,
	shouldSuppressVisuallyHiddenElement,
} from "./page-artifacts-extraction-dom.ts";
import {
	compactHeadingPath,
	type HtmlDomApi,
	normalizeOptionalString,
	normalizePageTitle,
	normalizeText,
	resolveAnchorTargetUrl,
} from "./page-artifacts-helpers.ts";
import type { ExtractedBlockCandidate } from "./page-artifacts-types.ts";

export {
	extractRecoveryBlockCandidates,
	looksLikeDynamicShell,
	looksLikeStructuralShell,
} from "./page-artifacts-extraction-recovery.ts";

export function extractBlockCandidates(input: {
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	siteDisplayName: string;
}): ExtractedBlockCandidate[] {
	const $: HtmlDomApi = input.html;
	const selector = [
		"title",
		"body h1",
		"body h2",
		"body h3",
		"body h4",
		"body h5",
		"body h6",
		"body p",
		"body li",
		"body dt",
		"body table",
		"body a",
	].join(", ");
	const elements = $(selector).toArray() as unknown[];
	const headingPath: string[] = [];
	const candidates: ExtractedBlockCandidate[] = [];

	for (const element of elements) {
		const tagName = String((element as { tagName?: unknown }).tagName ?? "").toLowerCase();
		if (tagName === "li" && shouldSuppressAggregateListItem($, element)) {
			continue;
		}
		if (tagName === "table" && shouldSuppressAggregateTable($, element)) {
			continue;
		}
		if (tagName !== "title" && shouldSuppressVisuallyHiddenElement($, element)) {
			continue;
		}

		const textRaw = extractElementText($, element);
		if (textRaw == null && tagName !== "table") {
			continue;
		}

		const domPath = buildDomPath($, element);
		const hasMainContentAncestor = hasMainContentAncestorCue($, element);
		const isInBoilerplateRegion = hasBoilerplateRegionAncestor($, element);
		const hasNavigationalListAncestor =
			tagName === "a" ? hasNavigationalListContext($, element, hasMainContentAncestor) : false;
		const isNavigation =
			hasNavigationAncestor($, element) ||
			hasNavigationalListAncestor ||
			((tagName === "li" || tagName === "dt") &&
				isLikelyNavigationalListItem($, element, hasMainContentAncestor));
		const isFooter = hasTagAncestor($, element, "footer");
		const isBoilerplate = isNavigation || isFooter || isInBoilerplateRegion;
		const headingLevel = /^h\d$/.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null;
		const isStructuralHeading =
			headingLevel != null && shouldUpdateHeadingPath($, element, isBoilerplate);
		const parentHeadingPath = isBoilerplate
			? []
			: headingLevel == null
				? compactHeadingPath(headingPath)
				: compactHeadingPath(
						isStructuralHeading ? headingPath.slice(0, Math.max(headingLevel - 1, 0)) : headingPath,
					);
		const textNormalized =
			tagName === "title"
				? normalizePageTitle(textRaw, input.siteDisplayName)
				: normalizeText(textRaw);
		const suppressAggregateAnchorDuplicateTitle =
			!isBoilerplate &&
			shouldDemoteAggregateAnchorTitleDescendant($, element, tagName, textNormalized);
		const isMainContent =
			!(isBoilerplate || suppressAggregateAnchorDuplicateTitle) &&
			(/^h\d$/.test(tagName) ||
				tagName === "p" ||
				(tagName === "table" && isLikelyMainContentTable($, element, hasMainContentAncestor)) ||
				((tagName === "li" || tagName === "dt") &&
					isLikelyMainContentListItem($, element, hasMainContentAncestor)) ||
				(tagName === "a" &&
					isLikelyMainContentAnchor($, element, hasMainContentAncestor, input.baseUrl)));
		const sectionHint = isBoilerplate
			? null
			: headingLevel == null
				? (parentHeadingPath.at(-1) ?? null)
				: textNormalized;
		const parentHeadingHint = parentHeadingPath.at(-1) ?? null;

		if (isStructuralHeading && textNormalized != null && headingLevel != null) {
			headingPath.splice(headingLevel - 1);
			headingPath[headingLevel - 1] = textNormalized;
		}

		candidates.push({
			blockRole: resolveBlockRole(tagName, isNavigation, isFooter),
			headingLevel,
			domPath,
			parentHeadingPath,
			listLevel:
				tagName === "li"
					? $(element).parents("ul,ol").length
					: tagName === "dt"
						? $(element).parents("dl").length
						: null,
			tableId: tagName === "table" ? domPath : null,
			tableRowIndex: null,
			tableColIndex: null,
			textRaw,
			textNormalized,
			htmlFragment: tagName === "title" ? null : extractElementHtmlFragment($, element),
			linkTarget: tagName === "a" ? resolveAnchorTargetUrl($, element, input.baseUrl) : null,
			linkText: tagName === "a" ? textNormalized : null,
			tableHtml: tagName === "table" ? normalizeOptionalString($.html(element)) : null,
			tableCells: tagName === "table" ? extractTableCells($, element) : null,
			isNavigation,
			isBoilerplate,
			isMainContent,
			mainContentScore: isMainContent ? 1 : isBoilerplate ? 0.1 : 0.4,
			titleCandidateScore: tagName === "title" || headingLevel === 1 ? 1 : 0,
			sectionHint,
			classificationConfidence: isMainContent ? 0.95 : isBoilerplate ? 0.92 : 0.7,
			classificationReason: isMainContent
				? "main_content_structure"
				: isBoilerplate
					? isInBoilerplateRegion
						? "boilerplate_region_ancestor"
						: "navigation_or_footer_ancestor"
					: "fallback_block_selector",
			parentHeadingHint,
		});
	}

	return candidates;
}

export function extractDiscoveredLinks(input: {
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	rawAssetId: string;
	rawVersionId: string;
}): OfficialWebDiscoveredLinkRecord[] {
	const $: HtmlDomApi = input.html;
	const anchors = $("a[href]").toArray() as unknown[];

	return anchors.map((element, index) => {
		const hrefRaw = String($(element).attr("href") ?? "");
		const resolvedUrl = resolveAnchorTargetUrl($, element, input.baseUrl);
		const admission =
			resolvedUrl == null
				? null
				: admitOfficialWebUrl(input.bundle, {
						url: resolvedUrl,
						discoveryMethod: "navigation",
						sourceHost: input.hostPolicy.host,
					});

		return buildOfficialWebDiscoveredLinkRecord({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			linkOrder: index,
			sourceUrl: input.baseUrl,
			hrefRaw,
			resolvedUrl,
			normalizedUrl: admission?.admitted ? admission.normalizedUrl : null,
			linkText: normalizeText($(element).text()),
			rel: normalizeOptionalString($(element).attr("rel")),
			admitted: admission?.admitted ?? false,
			admissionReason: admission?.reason ?? "invalid_url",
		});
	});
}
