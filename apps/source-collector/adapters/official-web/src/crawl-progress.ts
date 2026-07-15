import type { OfficialWebCrawlCandidate as OfficialWebPlannerPageCandidate } from "./crawl-candidates.ts";
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

function sanitizeCounterKey(value: string | undefined): string {
	return (value || "unknown").replace(/[^A-Za-z0-9_:-]+/g, "_");
}

export function buildTargetWorksetProgressCounts(
	pages: OfficialWebPlannerPageCandidate[],
): Record<string, number> {
	const counts: Record<string, number> = {
		targetWorksetRows: pages.length,
		targetJobs: new Set(pages.map((page) => page.targetJobId || "unknown")).size,
		consumerFamilies: new Set(pages.map((page) => page.consumerFamily || "unknown")).size,
	};
	for (const page of pages) {
		const targetJobId = sanitizeCounterKey(page.targetJobId);
		const consumerFamily = sanitizeCounterKey(page.consumerFamily);
		counts[`targetJob.${targetJobId}.worksetRows`] =
			(counts[`targetJob.${targetJobId}.worksetRows`] ?? 0) + 1;
		counts[`consumerFamily.${consumerFamily}.worksetRows`] =
			(counts[`consumerFamily.${consumerFamily}.worksetRows`] ?? 0) + 1;
	}
	return counts;
}

export function sameProgressCounts(
	a: CollectorProgressCounts,
	b: CollectorProgressCounts,
): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (a[key] !== b[key]) {
			return false;
		}
	}
	return true;
}

export function countUniqueRawAssets(pages: CollectedPageArtifact[]): number {
	return new Set(pages.map((item) => item.rawAssetId)).size;
}
