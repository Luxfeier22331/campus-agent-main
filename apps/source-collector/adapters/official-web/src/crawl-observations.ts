import {
	buildOfficialWebPageObservationRecord,
	type OfficialWebPageObservationRecord,
	type OfficialWebRunIntent,
} from "./core/index.ts";
import type { OfficialWebCrawlCandidate as OfficialWebPlannerPageCandidate } from "./crawl-candidates.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export function buildPageObservationFromCollectedPage(
	siteId: string,
	crawlRunId: string,
	runIntent: OfficialWebRunIntent,
	page: CollectedPageArtifact,
	configuredSeedUrl: string | null = null,
): OfficialWebPageObservationRecord {
	return buildOfficialWebPageObservationRecord({
		configuredSeedUrl,
		siteId,
		crawlRunId,
		runIntent,
		rawAssetId: page.rawAssetId,
		rawVersionId: page.rawVersionId,
		host: page.pageManifest.host,
		requestedUrl: page.observation.requestedUrl,
		finalUrl: page.observation.finalUrl,
		normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
		pageFamily: page.pageManifest.pageFamily,
		pageTitleNormalized: page.pageManifest.pageTitleNormalized,
		discoveryMethod: page.observation.discoveryMethod,
		discoveredFromUrl: page.observation.discoveredFromUrl,
		httpStatus: page.observation.httpStatus,
		contentType: page.observation.contentType,
		crawlPolicyVersion: page.observation.crawlPolicyVersion,
		credentialsMode: page.observation.credentialsMode,
		declaredCanonicalUrl: page.observation.declaredCanonicalUrl,
		etag: page.observation.etag,
		hostPolicyVersion: page.observation.hostPolicyVersion,
		lastModified: page.observation.lastModified,
		redirectChain: page.observation.redirectChain,
		responseBodyHash: page.pageManifest.responseBodyHash,
		mainContentHash: page.pageManifest.mainContentHash,
		disposition: "fetched",
		observedAt: page.observation.fetchedAt,
		targetCandidateId: page.targeting.targetCandidateId,
		targetDeclarationVersion: page.targeting.targetDeclarationVersion,
		targetId: page.targeting.targetMatches[0]?.targetId,
		targetJobId: page.targeting.targetJobId,
		targetMatches: page.targeting.targetMatches,
	});
}

export function buildKnownPageObservation(input: {
	crawlRunId: string;
	configuredSeedUrl?: string | null;
	disposition: "deleted" | "fetch_failed" | "not_modified";
	finalUrl: string;
	httpStatus: number | null;
	knownPage: OfficialWebPlannerPageCandidate;
	observedAt: string;
	requestedUrl: string;
	runIntent: OfficialWebRunIntent;
}): OfficialWebPageObservationRecord {
	return buildOfficialWebPageObservationRecord({
		configuredSeedUrl: input.configuredSeedUrl ?? null,
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
		crawlPolicyVersion: null,
		credentialsMode: null,
		declaredCanonicalUrl: null,
		etag: input.knownPage.etag,
		hostPolicyVersion: null,
		lastModified: input.knownPage.lastModified,
		redirectChain: [],
		responseBodyHash:
			input.disposition === "not_modified" ? input.knownPage.responseBodyHash : null,
		mainContentHash: input.disposition === "not_modified" ? input.knownPage.mainContentHash : null,
		disposition: input.disposition,
		observedAt: input.observedAt,
		targetCandidateId: input.knownPage.targetCandidateId,
		targetDeclarationVersion: input.knownPage.targetDeclarationVersion,
		targetId: input.knownPage.targetId,
		targetJobId: input.knownPage.targetJobId,
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
