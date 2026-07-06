import type {
	PublishedReaderManifestEntry,
	PublishedReaderSearchUnit,
} from "./published-reader-manifest.d.mts";

export interface ReaderObjectStoreClient {
	readTextObject(input: { key: string }): Promise<string>;
}

export function buildSearchUnitsByVersionId(
	searchUnits: unknown[],
): Map<string, PublishedReaderSearchUnit[]>;

export function assertProtectedSearchUnitsReferenceReader(input: {
	client: ReaderObjectStoreClient;
	entries: PublishedReaderManifestEntry[];
	searchUnitsByVersionId: Map<string, PublishedReaderSearchUnit[]>;
}): Promise<void>;

export function buildProtectedSearchEntry(input: {
	entry: PublishedReaderManifestEntry & { routeSlug: string };
	resolveCollectionLabel(entry: PublishedReaderManifestEntry): string;
	unit: PublishedReaderSearchUnit;
}): {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	collectionLabel: string;
	corpus: string;
	documentSlug: string;
	documentTitle: string;
	highlightRootUnitIds: string[];
	searchText: string;
	searchUnitId: string;
	sectionTitle: string;
	snippet: string;
	versionSlug: string;
};
