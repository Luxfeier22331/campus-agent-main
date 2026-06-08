import { requestJson } from "@/platform/api/client";
import type { DocsNavigationResponse, DocsResolveResponse, DocsSearchResponse } from "./model";

export async function getDocsNavigation(input: {
	collection: string;
	corpus: string;
}): Promise<DocsNavigationResponse> {
	return requestJson<DocsNavigationResponse>({
		path: `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
			input.collection,
		)}/navigation`,
	});
}

export async function resolveDocument(input: {
	collection: string;
	corpus: string;
	documentSlug: string;
}): Promise<DocsResolveResponse> {
	return requestJson<DocsResolveResponse>({
		path: `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
			input.collection,
		)}/documents/${encodeURIComponent(input.documentSlug)}/resolve`,
	});
}

export async function searchDocs(input: {
	collection: string;
	corpus: string;
	query: string;
}): Promise<DocsSearchResponse> {
	const params = new URLSearchParams({ q: input.query });
	return requestJson<DocsSearchResponse>({
		path: `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
			input.collection,
		)}/search?${params.toString()}`,
	});
}
