import type { CheerioAPI } from "cheerio";
import type { OfficialWebNextContentBlock, OfficialWebNextDiscoveredLink } from "./types.ts";

export function extractContentBlocks(input: {
	$: CheerioAPI;
	baseUrl: string;
	rawAssetId: string;
	rawVersionId: string;
}): OfficialWebNextContentBlock[] {
	const blocks: OfficialWebNextContentBlock[] = [];
	const elements = input
		.$(
			"title, body h1, body h2, body h3, body h4, body h5, body h6, body p, body li, body table, body a, body img",
		)
		.toArray();
	for (const element of elements) {
		const $element = input.$(element);
		const tagName = element.tagName.toLowerCase();
		const text = normalizeText($element.text());
		const tableCells =
			tagName === "table"
				? $element
						.find("tr")
						.toArray()
						.map((row) =>
							input
								.$(row)
								.find("th,td")
								.toArray()
								.map((cell) => normalizeText(input.$(cell).text()) ?? ""),
						)
				: null;
		const linkTarget =
			tagName === "a"
				? resolveUrl($element.attr("href") ?? "", resolveBaseUrl(input.$, input.baseUrl))
				: tagName === "img"
					? resolveUrl(
							$element.attr("src") ?? $element.attr("data-src") ?? "",
							resolveBaseUrl(input.$, input.baseUrl),
						)
					: null;
		if (!(text || linkTarget || (tableCells && tableCells.length > 0))) {
			continue;
		}
		blocks.push({
			schemaVersion: "official_web_next_content_block.v1",
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			rowIndex: blocks.length,
			blockRole: blockRole(tagName),
			headingLevel: /^h\d$/u.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null,
			textNormalized: text,
			linkTarget,
			tableCells,
			isMainContent: !isBoilerplate(input.$, element),
		});
	}
	return blocks;
}

export function extractDiscoveredLinks(input: {
	$: CheerioAPI;
	baseUrl: string;
	host: string;
	rawAssetId: string;
	rawVersionId: string;
}): OfficialWebNextDiscoveredLink[] {
	return input
		.$("a[href]")
		.toArray()
		.map((element, index) => {
			const hrefRaw = String(input.$(element).attr("href") ?? "");
			const resolvedUrl = resolveUrl(hrefRaw, input.baseUrl);
			const admission = resolveLinkAdmission(resolvedUrl, input.host);
			return {
				schemaVersion: "official_web_next_discovered_link.v1",
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				linkOrder: index,
				sourceUrl: input.baseUrl,
				hrefRaw,
				resolvedUrl,
				admitted: admission === "same_host",
				admissionReason: admission,
			};
		});
}

export function normalizeText(value: string): string | null {
	const normalized = value.replace(/\s+/gu, " ").trim();
	return normalized.length > 0 ? normalized : null;
}

function blockRole(tagName: string): OfficialWebNextContentBlock["blockRole"] {
	if (tagName === "title") {
		return "title";
	}
	if (/^h\d$/u.test(tagName)) {
		return "heading";
	}
	if (tagName === "p") {
		return "paragraph";
	}
	if (tagName === "li") {
		return "list_item";
	}
	if (tagName === "table") {
		return "table";
	}
	if (tagName === "a") {
		return "link";
	}
	return "image";
}

function isBoilerplate($: CheerioAPI, element: Parameters<CheerioAPI>[0]): boolean {
	return $(element).parents("nav,header,footer").length > 0;
}

function resolveLinkAdmission(value: string | null, host: string) {
	if (value == null) {
		return "invalid_url" as const;
	}
	try {
		const url = new URL(value);
		return url.hostname.toLowerCase() === host.toLowerCase() ? "same_host" : "cross_host";
	} catch {
		return "invalid_url" as const;
	}
}

function resolveUrl(value: string, baseUrl: string): string | null {
	try {
		return new URL(value, baseUrl || undefined).toString();
	} catch {
		return null;
	}
}

function resolveBaseUrl($: CheerioAPI, fallbackUrl: string): string {
	const declaredBaseUrl = $("base[href]").first().attr("href");
	return declaredBaseUrl ? (resolveUrl(declaredBaseUrl, fallbackUrl) ?? fallbackUrl) : fallbackUrl;
}
