import type {
	PublishedReaderManifestEntry,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";

export function attachReaderRouteSlugs(
	entries: PublishedReaderManifestEntry[],
): RoutedPublishedReaderManifestEntry[] {
	return entries.map((entry) => ({ ...entry }));
}

export function buildReaderCanonicalUrl(entry: RoutedPublishedReaderManifestEntry): string {
	const base = `/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}`;
	return entry.isCurrent ? base : `${base}/v/${encodeURIComponent(entry.versionSlug)}`;
}

export function compareEntryRoute(
	left: RoutedPublishedReaderManifestEntry,
	right: RoutedPublishedReaderManifestEntry,
): number {
	return `${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`.localeCompare(
		`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
	);
}

export function resolveDocumentVersionKey(entry: PublishedReaderManifestEntry): string {
	return `${entry.corpus}/${entry.collection}/${entry.docId}`;
}
