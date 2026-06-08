export interface DocsNavigationResponse {
	collection: {
		collection: string;
		corpus: string;
		description?: string;
		displayName: string;
	};
	nodes: Array<{
		canonicalUrl: string;
		documentSlug: string;
		isCurrent: boolean;
		kind: "document" | "section";
		title: string;
	}>;
}

export interface DocsResolveResponse {
	document: {
		canonicalUrl: string;
		collection: string;
		corpus: string;
		docId: string;
		documentSlug: string;
		title: string;
		updatedAt: string;
		versionId: string;
		versionSlug: string;
	};
	readerAsset: {
		canonicalUrl: string;
		contentUrl: string;
		deliveryMode: "gated_asset" | "public_static_asset";
		outlineUrl: string;
	};
	readerState: {
		anchor: string | null;
		highlightRootUnitIds: string[];
	};
	resolvedVersion: {
		isCurrent: boolean;
		label: string;
		versionId: string;
		versionSlug: string;
	};
}

export interface DocsSearchResponse {
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
