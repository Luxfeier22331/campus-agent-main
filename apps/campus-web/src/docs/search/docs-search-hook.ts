import { searchIndexHash } from "virtual-page-data";
import {
	collectDocsSearchScopes,
	type DocsApiSearchResponse,
	type DocsApiSearchSuggestion,
	mapDocsApiResultsToSuggestions,
	type ScopedDocsApiSearchResponse,
	type SearchIndexPage,
	type SearchSuggestion,
} from "./docs-api-search-core";

interface DefaultSearchGroup {
	group: string;
	renderType: "default";
	result: SearchSuggestion[];
}

interface DocsApiSearchOutcome {
	results: DocsApiSearchSuggestion[];
}

let pagesPromise: Promise<SearchIndexPage[]> | null = null;

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
): Promise<DocsApiSearchOutcome> {
	const scopes = collectDocsSearchScopes(pages);
	if (scopes.length === 0) {
		return { results: [] };
	}
	const responses = (
		await Promise.all(
			scopes.map(async (scope): Promise<ScopedDocsApiSearchResponse | null> => {
				const params = new URLSearchParams({ limit: "5", q: query, versionMode: "current" });
				const url = `/api/docs/collections/${encodeURIComponent(scope.corpus)}/${encodeURIComponent(scope.collection)}/search?${params}`;
				const response = await fetch(url, { headers: { accept: "application/json" } });
				if (!response.ok) {
					throw new Error("docs search failed");
				}
				return {
					response: (await response.json()) as DocsApiSearchResponse,
					scope,
				};
			}),
		)
	).filter((response): response is ScopedDocsApiSearchResponse => Boolean(response));
	return { results: mapDocsApiResultsToSuggestions(query, responses) };
}

export async function onSearch(query: string, matchedResult: DefaultSearchGroup[]): Promise<void> {
	matchedResult.splice(0, matchedResult.length);
	const pages = await getSearchIndexPages();
	let docsApiOutcome: DocsApiSearchOutcome;
	try {
		docsApiOutcome = await searchDocsApi(query, pages);
	} catch {
		return;
	}
	if (docsApiOutcome.results.length > 0) {
		matchedResult.unshift({
			group: "文档命中",
			renderType: "default",
			result: docsApiOutcome.results,
		});
	}
}
