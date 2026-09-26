import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import type {
	PublishedReaderManifestEntry,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";

export function attachReaderRouteSlugs(
	entries: PublishedReaderManifestEntry[],
): RoutedPublishedReaderManifestEntry[] {
	return entries.map((entry) => ({ ...entry }));
}

export function buildReaderDocumentUrl(entry: RoutedPublishedReaderManifestEntry): string {
	return `/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}`;
}

export function buildReaderCanonicalUrl(
	entry: RoutedPublishedReaderManifestEntry,
	latestVersionId: string,
): string {
	return entry.versionId === latestVersionId
		? buildReaderDocumentUrl(entry)
		: buildReaderVersionUrl(entry);
}

export function buildReaderVersionUrl(entry: RoutedPublishedReaderManifestEntry): string {
	return `/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}/v/${encodeURIComponent(entry.versionSlug)}`;
}

export function compareEntryRoute(
	left: RoutedPublishedReaderManifestEntry,
	right: RoutedPublishedReaderManifestEntry,
): number {
	return compareCanonicalStrings(
		`${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`,
		`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
	);
}

export function resolveDocumentVersionKey(entry: PublishedReaderManifestEntry): string {
	return `${entry.corpus}/${entry.collection}/${entry.docId}`;
}
