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
	anchor?: string | null;
	collection: string;
	corpus: string;
	documentSlug: string;
	highlightRootUnitIds?: string[];
	versionSlug?: string | null;
}): Promise<DocsResolveResponse> {
	const params = new URLSearchParams();
	if (input.versionSlug) {
		params.set("version", input.versionSlug);
	}
	if (input.anchor) {
		params.set("anchor", input.anchor);
	}
	if (input.highlightRootUnitIds && input.highlightRootUnitIds.length > 0) {
		params.set("hl", input.highlightRootUnitIds.join(","));
	}
	const query = params.size > 0 ? `?${params.toString()}` : "";
	return requestJson<DocsResolveResponse>({
		path: `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
			input.collection,
		)}/documents/${encodeURIComponent(input.documentSlug)}/resolve${query}`,
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
