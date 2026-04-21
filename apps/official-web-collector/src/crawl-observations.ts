import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import {
	buildOfficialWebPageObservationRecord,
	type OfficialWebPageObservationRecord,
	type OfficialWebRunIntent,
} from "./official-web-core.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export function buildPageObservationFromCollectedPage(
	siteId: string,
	crawlRunId: string,
	runIntent: OfficialWebRunIntent,
	page: CollectedPageArtifact,
): OfficialWebPageObservationRecord {
	return buildOfficialWebPageObservationRecord({
		siteId,
		crawlRunId,
		runIntent,
		rawAssetId: page.rawAssetId,
		rawVersionId: page.rawVersionId,
		host: page.pageManifest.host,
		requestedUrl: page.pageManifest.requestedUrl,
		finalUrl: page.pageManifest.finalUrl,
		normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
		pageFamily: page.pageManifest.pageFamily,
		pageTitleNormalized: page.pageManifest.pageTitleNormalized,
		discoveryMethod: page.pageManifest.discoveryMethod,
		discoveredFromUrl: page.pageManifest.discoveredFromUrl,
		httpStatus: page.pageManifest.httpStatus,
		contentType: page.pageManifest.contentType,
		etag: page.pageManifest.etag,
		lastModified: page.pageManifest.lastModified,
		responseBodyHash: page.pageManifest.responseBodyHash,
		mainContentHash: page.pageManifest.mainContentHash,
		disposition: "fetched",
		observedAt: page.pageManifest.fetchedAt,
	});
}

export function buildKnownPageObservation(input: {
	crawlRunId: string;
	disposition: "deleted" | "fetch_failed" | "not_modified";
	finalUrl: string;
	httpStatus: number | null;
	knownPage: OfficialWebPlannerPageCandidate;
	observedAt: string;
	requestedUrl: string;
	runIntent: OfficialWebRunIntent;
}): OfficialWebPageObservationRecord {
	return buildOfficialWebPageObservationRecord({
		siteId: input.knownPage.siteId,
		crawlRunId: input.crawlRunId,
		runIntent: input.runIntent,
		rawAssetId: null,
		rawVersionId: null,
		host: input.knownPage.host,
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		normalizedCanonicalUrl: input.knownPage.normalizedCanonicalUrl,
		pageFamily: input.knownPage.pageFamily as CollectedPageArtifact["pageManifest"]["pageFamily"],
		pageTitleNormalized: input.knownPage.pageTitleNormalized,
		discoveryMethod: input.knownPage.discoveryMethod,
		discoveredFromUrl: input.knownPage.discoveredFromUrl,
		httpStatus: input.httpStatus,
		contentType: input.knownPage.contentType,
		etag: input.knownPage.etag,
		lastModified: input.knownPage.lastModified,
		responseBodyHash:
			input.disposition === "not_modified" ? input.knownPage.responseBodyHash : null,
		mainContentHash: input.disposition === "not_modified" ? input.knownPage.mainContentHash : null,
		disposition: input.disposition,
		observedAt: input.observedAt,
	});
}

export function buildPageObservations(input: {
	siteId: string;
	crawlRunId: string;
	runIntent: OfficialWebRunIntent;
	pages: CollectedPageArtifact[];
}): OfficialWebPageObservationRecord[] {
	return input.pages.map((page) =>
		buildPageObservationFromCollectedPage(input.siteId, input.crawlRunId, input.runIntent, page),
	);
}
