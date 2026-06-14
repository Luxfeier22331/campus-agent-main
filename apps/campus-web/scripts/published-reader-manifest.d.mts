export interface PublishedReaderObjectStoreClient {
	readTextObject(input: { key: string }): Promise<string>;
}

export interface PublishedReaderManifestEntry {
	collection: string;
	corpus: string;
	deliveryMode: "public_static_asset" | "gated_asset" | "withheld";
	docId?: string;
	documentSlug: string;
	isCurrent: boolean;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
	title: string;
	versionId?: string;
	versionLabel?: string;
	versionSlug: string;
}

export interface PublishedReaderSearchUnit {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	corpus: string;
	docId?: string;
	documentSlug: string;
	documentTitle: string;
	highlightRootUnitIds: string[];
	searchUnitId: string;
	snippet: string;
	title: string;
	versionId: string;
	versionSlug: string;
}

export interface PublishedReaderManifest {
	entries: PublishedReaderManifestEntry[];
	generatedAt?: string;
	searchUnits: unknown[];
}

export function loadPublishedReaderManifest(input: {
	client: PublishedReaderObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<PublishedReaderManifest>;

export function normalizeSearchUnit(value: unknown): PublishedReaderSearchUnit;
