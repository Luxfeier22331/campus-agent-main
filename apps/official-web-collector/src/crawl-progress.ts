import type {
	CollectorAggregatedResults,
	CollectorProgressCounts,
} from "./crawl-internal-types.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export function summarizeProgressCounts(
	aggregatedResults: CollectorAggregatedResults,
	artifactUploadCount: number,
): CollectorProgressCounts {
	return {
		urlsDiscovered: aggregatedResults.urlResults.length,
		urlsFetched: aggregatedResults.urlResults.filter((item) => item.outcome === "fetched").length,
		pagesNormalized: aggregatedResults.pages.length,
		artifactUploads: artifactUploadCount,
		failures: aggregatedResults.failures.length,
	};
}

export function emptyProgressCounts(): CollectorProgressCounts {
	return {
		urlsDiscovered: 0,
		urlsFetched: 0,
		pagesNormalized: 0,
		artifactUploads: 0,
		failures: 0,
	};
}

export function sameProgressCounts(
	a: CollectorProgressCounts,
	b: CollectorProgressCounts,
): boolean {
	return (
		a.urlsDiscovered === b.urlsDiscovered &&
		a.urlsFetched === b.urlsFetched &&
		a.pagesNormalized === b.pagesNormalized &&
		a.artifactUploads === b.artifactUploads &&
		a.failures === b.failures
	);
}

export function countUniqueRawAssets(pages: CollectedPageArtifact[]): number {
	return new Set(pages.map((item) => item.rawAssetId)).size;
}
