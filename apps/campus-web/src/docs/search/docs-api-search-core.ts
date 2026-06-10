export interface SearchIndexHeader {
	id: string;
	text: string;
	charIndex?: number;
}

export interface SearchIndexPage {
	title: string;
	routePath: string;
	content: string;
	toc: SearchIndexHeader[];
}

interface HighlightInfo {
	start: number;
	length: number;
}

export interface SearchSuggestion {
	type: string;
	title: string;
	header: string;
	link: string;
	query: string;
	statement?: string;
	highlightInfoList: HighlightInfo[];
}

export interface DocsApiSearchSuggestion {
	type: "content";
	title: string;
	header: string;
	link: string;
	query: string;
	statement: string;
	highlightInfoList: HighlightInfo[];
}

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
): DocsApiSearchSuggestion[] {
	const normalizedQuery = query.trim();
	const highlightLength = new TextEncoder().encode(normalizedQuery).length;
	return responses.flatMap(({ response }) =>
		response.results.map((result) => {
			const snippetIndex = result.snippet.indexOf(normalizedQuery);
			return {
				header: `${result.documentTitle} > ${result.title}`,
				highlightInfoList: [
					{
						length: highlightLength,
						start: snippetIndex >= 0 ? snippetIndex : 0,
					},
				],
				link: result.canonicalUrl,
				query: normalizedQuery,
				statement: result.snippet,
				title: result.documentTitle,
				type: "content" as const,
			};
		}),
	);
}
