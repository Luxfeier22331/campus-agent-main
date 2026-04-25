import { searchIndexHash } from "virtual-page-data";
import {
	type LocalSearchFallbackSuggestion,
	type SearchIndexPage,
	buildLocalSearchFallbackResults,
} from "./local-search-fallback-core";

interface DefaultSearchGroup {
	group: string;
	renderType: "default";
	result: LocalSearchFallbackSuggestion[];
}

let pagesPromise: Promise<SearchIndexPage[]> | null = null;

function hasDefaultResults(matchedResult: DefaultSearchGroup[]): boolean {
	return matchedResult.some((group) => group.result.length > 0);
}

function resolveStaticBasePath(): string {
	const script = document.querySelector<HTMLScriptElement>('script[src*="/static/js/"]');
	if (!script) {
		return "/static/";
	}

	const scriptUrl = new URL(script.src, window.location.href);
	const staticIndex = scriptUrl.pathname.indexOf("/static/");
	if (staticIndex < 0) {
		return "/static/";
	}

	return `${scriptUrl.pathname.slice(0, staticIndex)}/static/`.replace("//", "/");
}

function resolveSearchIndexUrl(): string | null {
	const entry =
		Object.entries(searchIndexHash).find(([groupId]) => groupId.endsWith("###zh")) ??
		Object.entries(searchIndexHash)[0];
	if (!entry) {
		return null;
	}

	const [groupId, hash] = entry;
	const [version = "", lang = ""] = groupId.split("###");
	const versionPart = version ? `.${version.replace(/\./g, "_")}` : "";
	const langPart = lang ? `.${lang}` : "";
	return `${resolveStaticBasePath()}search_index${versionPart}${langPart}.${hash}.json`;
}

async function loadSearchIndexPages(): Promise<SearchIndexPage[]> {
	const url = resolveSearchIndexUrl();
	if (!url) {
		return [];
	}

	const response = await fetch(url);
	if (!response.ok) {
		return [];
	}

	return (await response.json()) as SearchIndexPage[];
}

async function getSearchIndexPages(): Promise<SearchIndexPage[]> {
	pagesPromise ??= loadSearchIndexPages();
	return pagesPromise;
}

export async function onSearch(query: string, matchedResult: DefaultSearchGroup[]): Promise<void> {
	if (hasDefaultResults(matchedResult)) {
		return;
	}

	const fallbackResults = buildLocalSearchFallbackResults(query, await getSearchIndexPages());
	if (fallbackResults.length === 0) {
		return;
	}

	if (matchedResult[0]) {
		matchedResult[0].result = fallbackResults;
		return;
	}

	matchedResult.push({
		group: "Campus Agent 文档站",
		renderType: "default",
		result: fallbackResults,
	});
}
