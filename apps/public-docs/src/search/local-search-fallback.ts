import { searchIndexHash } from "virtual-page-data";
import {
	collectDocsSearchScopes,
	type DocsApiSearchResponse,
	mapDocsApiResultsToSuggestions,
	type ScopedDocsApiSearchResponse,
} from "./docs-api-search-core";
import {
	buildLocalSearchFallbackResults,
	type LocalSearchFallbackSuggestion,
	type SearchIndexPage,
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

async function searchDocsApi(
	query: string,
	pages: SearchIndexPage[],
): Promise<LocalSearchFallbackSuggestion[]> {
	const scopes = collectDocsSearchScopes(pages);
	const responses = (
		await Promise.all(
			scopes.map(async (scope): Promise<ScopedDocsApiSearchResponse | null> => {
				const params = new URLSearchParams({ limit: "5", q: query, versionMode: "current" });
				const url = `/api/docs/collections/${encodeURIComponent(scope.corpus)}/${encodeURIComponent(scope.collection)}/search?${params}`;
				try {
					const response = await fetch(url, { headers: { accept: "application/json" } });
					if (!response.ok) {
						return null;
					}
					return {
						scope,
						response: (await response.json()) as DocsApiSearchResponse,
					};
				} catch {
					return null;
				}
			}),
		)
	).filter((response): response is ScopedDocsApiSearchResponse => Boolean(response));
	return mapDocsApiResultsToSuggestions(query, responses);
}

export async function onSearch(query: string, matchedResult: DefaultSearchGroup[]): Promise<void> {
	const pages = await getSearchIndexPages();
	const docsApiResults = await searchDocsApi(query, pages);
	if (docsApiResults.length > 0) {
		matchedResult.unshift({
			group: "文档命中",
			renderType: "default",
			result: docsApiResults,
		});
		return;
	}

	if (hasDefaultResults(matchedResult)) {
		return;
	}

	const fallbackResults = buildLocalSearchFallbackResults(query, pages);
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
