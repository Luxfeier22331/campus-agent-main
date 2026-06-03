import type { CheerioCrawlingContext } from "crawlee";
import {
	extractElementText,
	hasBoilerplateRegionAncestor,
	hasCardLikeStructure,
	hasNavigationAncestor,
	hasTagAncestor,
	isGenericDetailLinkText,
} from "./page-artifacts-extraction-dom.ts";
import {
	containsDateLikeText,
	getDomTagName,
	type HtmlDomApi,
	type HtmlDomNode,
	normalizeText,
} from "./page-artifacts-helpers.ts";
import type { VisibleContentContainerStats } from "./page-artifacts-types.ts";

export function analyzeVisibleShellContainers(
	html: CheerioCrawlingContext["$"],
): VisibleContentContainerStats[] {
	const $: HtmlDomApi = html;
	const candidateSelectors = [
		"#vsb_content",
		"#maincontent",
		".right-con",
		".text-list",
		".list_content",
		".wape-right",
		".ny-right",
		".lba",
		".detail-shell",
		".panel-body",
		".news-panel",
		".notice-panel",
		".page-shell",
		".homepage-shell",
		"main",
		"article",
	];
	const pruneSelectors = [
		"script",
		"style",
		"noscript",
		"template",
		"nav",
		"header",
		"footer",
		"aside",
		".position",
		".breadcrumb",
		".biaoTi",
		".pagination",
		".pb_sys_common",
		".p_pages",
		".leftNav",
		".channl-menu",
		".lr",
		".sidebar",
	].join(", ");
	const containers: HtmlDomNode[] = [];

	for (const selector of candidateSelectors) {
		for (const element of $(selector).toArray() as HtmlDomNode[]) {
			if (containers.includes(element) || isBoilerplateContainer($, element)) {
				continue;
			}
			containers.push(element);
		}
	}

	for (const element of $("div,section,main,article").toArray() as HtmlDomNode[]) {
		if (containers.includes(element) || isBoilerplateContainer($, element)) {
			continue;
		}

		const classOrId =
			`${$(element).attr("class") ?? ""} ${$(element).attr("id") ?? ""}`.toLowerCase();
		if (
			!(
				/(^|[\s_-])(content|main|detail|panel|box|txt|article|post)([\s_-]|$)/.test(classOrId) ||
				looksLikeRepeatedCardClusterContainer($, element)
			)
		) {
			continue;
		}

		containers.push(element);
	}

	if (containers.length === 0) {
		return [];
	}

	return containers.map((element) => {
		const clone = $(element).clone();
		clone.find(pruneSelectors).remove();
		const textLength = (normalizeText(clone.text()) ?? "").length;
		const dateLikeTextCount = clone
			.find("div,span,time,p,li,dt,dd")
			.toArray()
			.filter((candidate: HtmlDomNode) => {
				const text = normalizeText($(candidate).text());
				return text != null && containsDateLikeText(text);
			}).length;
		const hasPagination =
			clone.is(".pagination,.pb_sys_common,.p_pages") ||
			clone.find(".pagination,.pb_sys_common,.p_pages").length > 0;
		const repeatedCardChildCount = countRepeatedCardChildren($, element);

		return {
			element,
			textLength,
			mediaCount: clone.find("img,picture,svg,video,iframe").length,
			listCount: clone.find("li").length,
			anchorCount: clone.find("a[href]").length,
			dateLikeTextCount,
			repeatedCardChildCount,
			hasPagination,
		};
	});
}

function isBoilerplateContainer($: HtmlDomApi, element: HtmlDomNode): boolean {
	return (
		hasNavigationAncestor($, element) ||
		hasBoilerplateRegionAncestor($, element) ||
		hasTagAncestor($, element, "header") ||
		hasTagAncestor($, element, "footer") ||
		hasTagAncestor($, element, "aside")
	);
}

function looksLikeRepeatedCardClusterContainer($: HtmlDomApi, element: HtmlDomNode): boolean {
	return countRepeatedCardChildren($, element) >= 2;
}

function countRepeatedCardChildren($: HtmlDomApi, element: HtmlDomNode): number {
	const counts = new Map<string, number>();

	for (const child of $(element)
		.children("div,section,article,li,dt,dd")
		.toArray() as HtmlDomNode[]) {
		if (!looksLikeRepeatedCardChild($, child)) {
			continue;
		}

		const signature = buildRepeatedChildSignature($, child);
		counts.set(signature, (counts.get(signature) ?? 0) + 1);
	}

	return [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
}

function looksLikeRepeatedCardChild($: HtmlDomApi, element: HtmlDomNode): boolean {
	const candidate = $(element);
	const textNormalized = normalizeText(extractElementText($, element));
	if (textNormalized == null) {
		return false;
	}

	const anchorTexts: string[] = candidate
		.find("a[href]")
		.toArray()
		.map((anchor: HtmlDomNode) => normalizeText(extractElementText($, anchor)))
		.filter((text: string | null): text is string => text != null);

	if (anchorTexts.length === 0) {
		return false;
	}

	const hasMeaningfulAnchorText = anchorTexts.some(
		(text: string) => !isGenericDetailLinkText(text),
	);
	if (!hasMeaningfulAnchorText) {
		return false;
	}

	return (
		containsDateLikeText(textNormalized) ||
		hasCardLikeStructure($, element) ||
		candidate.find("img,picture,video,svg").length > 0
	);
}

function buildRepeatedChildSignature($: HtmlDomApi, element: HtmlDomNode): string {
	const tagName = getDomTagName($(element)[0]);
	const classTokens = String($(element).attr("class") ?? "")
		.toLowerCase()
		.split(/\s+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const stableClassToken =
		classTokens.find((item) => /^[a-z][a-z0-9_-]{1,}$/.test(item) && !/^\d+$/.test(item)) ?? null;

	return stableClassToken == null ? `tag:${tagName}` : `class:${stableClassToken}`;
}
