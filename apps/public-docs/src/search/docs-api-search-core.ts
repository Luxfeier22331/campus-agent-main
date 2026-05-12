import type { SearchIndexPage, StaticSearchSuggestion } from "./static-search-suggestions";

export interface DocsSearchScope {
	collection: string;
	corpus: string;
}

export interface DocsApiSearchResponse {
	query: string;
	results: Array<{
		anchor: string;
		canonicalUrl: string;
		documentTitle: string;
		highlightRootUnitIds: string[];
		kind: "section_hit";
		snippet: string;
		title: string;
	}>;
}

export interface ScopedDocsApiSearchResponse {
	response: DocsApiSearchResponse;
	scope: DocsSearchScope;
}

export function collectDocsSearchScopes(pages: SearchIndexPage[]): DocsSearchScope[] {
	const scopes = new Map<string, DocsSearchScope>();
	for (const page of pages) {
		const path = page.routePath.split("#", 1)[0].split("?", 1)[0];
		const [root, corpus, collection] = path.split("/").filter(Boolean);
		if (!(root === "docs" && corpus && collection)) {
			continue;
		}
		const key = `${corpus}/${collection}`;
		if (!scopes.has(key)) {
			scopes.set(key, { collection, corpus });
		}
	}
	return [...scopes.values()];
}

export function mapDocsApiResultsToSuggestions(
	query: string,
	responses: ScopedDocsApiSearchResponse[],
): StaticSearchSuggestion[] {
	const normalizedQuery = query.trim();
	const highlightLength = new TextEncoder().encode(normalizedQuery).length;
	return responses.flatMap(({ response }) =>
		response.results.map((result) => {
			const snippetIndex = result.snippet.indexOf(normalizedQuery);
			return {
				type: "content" as const,
				title: result.documentTitle,
				header: `${result.documentTitle} > ${result.title}`,
				link: result.canonicalUrl,
				query: normalizedQuery,
				statement: result.snippet,
				highlightInfoList: [
					{
						start: snippetIndex >= 0 ? snippetIndex : 0,
						length: highlightLength,
					},
				],
			};
		}),
	);
}
