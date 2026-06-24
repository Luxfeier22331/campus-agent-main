import type { DefaultMatchResult, OnSearch, RenderSearchFunction } from "@rspress/core/theme";
import type { DocsProtectedSearchResult } from "./docs-search-model";
import {
	filterRspressLiteralResults,
	normalizeDocsSearchQuery,
	parseDocsProtectedSearchIndexPayload,
	searchProtectedDocsIndex,
} from "./docs-search-model";

export function beforeSearch(query: string): string {
	return normalizeDocsSearchQuery(query);
}

export const onSearch: OnSearch = async (query: string, defaultResults: DefaultMatchResult[]) => {
	filterRspressLiteralResults(query, defaultResults);
	const protectedIndexPath = resolveProtectedSearchIndexPath(window.location.pathname);
	if (!protectedIndexPath) {
		return [];
	}

	const response = await fetch(protectedIndexPath, {
		credentials: "include",
		headers: { accept: "application/json" },
	});
	if (response.status === 404 || response.status === 401) {
		return [];
	}
	if (!response.ok) {
		throw new Error(`protected docs search index request failed: ${response.status}`);
	}
	if (!isJsonResponse(response)) {
		return [];
	}
	const index = parseDocsProtectedSearchIndexPayload(await response.json());
	const protectedResults = searchProtectedDocsIndex(query, index);
	if (protectedResults.length === 0) {
		return [];
	}
	return [
		{
			group: "当前账号可见",
			result: protectedResults,
		},
	];
};

export const render: RenderSearchFunction<DocsProtectedSearchResult[]> = (results) => (
	<div className="docs-protected-search-results">
		{results.map((result) => (
			<a className="docs-protected-search-result" href={result.url} key={result.url}>
				<span className="docs-protected-search-title">{result.documentTitle}</span>
				<span className="docs-protected-search-section">{result.sectionTitle}</span>
				<small>{result.excerpt}</small>
			</a>
		))}
	</div>
);

function resolveProtectedSearchIndexPath(pathname: string): string | null {
	if (readCurrentReaderSearchVisibility() !== "gated_bootstrap") {
		return null;
	}
	let parts: string[];
	try {
		parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	if (parts[0] !== "docs" || parts.length < 4) {
		return null;
	}
	const [, corpus, collection] = parts;
	const documentSlug = readCurrentReaderDocumentSlug();
	const versionSlug = parts[4] === "v" ? parts[5] : readCurrentReaderVersionSlug();
	if (!(corpus && collection && documentSlug && versionSlug)) {
		return null;
	}
	return `/_gated-docs-search/${encodeURIComponent(corpus)}/${encodeURIComponent(
		collection,
	)}/${encodeURIComponent(documentSlug)}/${encodeURIComponent(versionSlug)}/index.json`;
}

function isJsonResponse(response: Response): boolean {
	return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

function readCurrentReaderSearchVisibility(): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const meta = document.querySelector<HTMLElement>("[data-docs-reader-meta]");
	return meta?.dataset.docsSearchVisibility?.trim() || null;
}

function readCurrentReaderDocumentSlug(): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const meta = document.querySelector<HTMLElement>("[data-docs-reader-meta]");
	return meta?.dataset.docsDocumentSlug?.trim() || null;
}

function readCurrentReaderVersionSlug(): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const meta = document.querySelector<HTMLElement>("[data-docs-reader-meta]");
	return meta?.dataset.docsVersionSlug?.trim() || null;
}
