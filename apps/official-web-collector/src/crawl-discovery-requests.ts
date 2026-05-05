import { type CheerioCrawlingContext, Sitemap } from "crawlee";
import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import type { CollectorRequestUserData, CollectorRobotsState } from "./crawl-internal-types.ts";
import { buildRobotsUserAgent } from "./crawl-support.ts";
import {
	admitOfficialWebUrl,
	buildOfficialWebUrlResultRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebHostPolicy,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "./official-web-core.ts";

export async function buildInitialRequests(input: {
	bundle: OfficialWebConfigBundle;
	plan: OfficialWebCrawlPlan;
	hostPolicy: OfficialWebHostPolicy;
	plannerPages: OfficialWebPlannerPageCandidate[];
	executionMode?: "target-workset" | "legacy-broad-crawl";
	robotsState: CollectorRobotsState;
	hostSummary: OfficialWebHostSummaryRecord;
	urlResults: OfficialWebUrlResultRecord[];
	disableConditionalHeaders?: boolean;
}): Promise<Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }>> {
	const candidates: Array<{
		url: string;
		discoveryMethod: CollectorRequestUserData["discoveryMethod"];
		discoveredFromUrl?: string | null;
		knownPage?: OfficialWebPlannerPageCandidate;
		knownPages?: OfficialWebPlannerPageCandidate[];
	}> = [];

	if (input.executionMode !== "target-workset") {
		candidates.push(
			...input.hostPolicy.seedUrls.map((url) => ({
				url,
				discoveryMethod: "seed" as const,
			})),
		);

		const robotsSitemaps = input.robotsState.robots?.getSitemaps() ?? [];
		if (robotsSitemaps.length > 0) {
			const discoveredUrls = await loadSitemapUrls(robotsSitemaps);
			for (const url of discoveredUrls) {
				candidates.push({ url, discoveryMethod: "robots_sitemap" });
			}
		}
		const configuredOnly = input.hostPolicy.explicitSitemaps.filter(
			(url) => !robotsSitemaps.includes(url),
		);
		if (configuredOnly.length > 0) {
			const discoveredUrls = await loadSitemapUrls(configuredOnly);
			for (const url of discoveredUrls) {
				candidates.push({ url, discoveryMethod: "configured_sitemap" });
			}
		}
	}
	for (const page of input.plannerPages) {
		candidates.push({
			url: page.normalizedCanonicalUrl,
			discoveryMethod: page.discoveryMethod,
			discoveredFromUrl: page.discoveredFromUrl,
			knownPage: page,
		});
	}

	const requests = new Map<
		string,
		{ url: string; uniqueKey: string; userData: CollectorRequestUserData }
	>();
	for (const candidate of candidates) {
		const admission = admitOfficialWebUrl(input.bundle, {
			url: candidate.url,
			discoveryMethod: candidate.discoveryMethod,
		});
		if (!admission.admitted || admission.normalizedUrl == null) {
			input.hostSummary.admissionRejected += 1;
			input.urlResults.push(
				buildOfficialWebUrlResultRecord({
					siteId: input.plan.siteId,
					crawlRunId: input.plan.crawlRunId,
					requestedUrl: candidate.url,
					finalUrl: null,
					declaredCanonicalUrl: null,
					normalizedCanonicalUrl: null,
					urlIdentityBasis: null,
					discoveryMethod: candidate.discoveryMethod,
					discoveredFromUrl: candidate.discoveredFromUrl ?? null,
					host: input.hostPolicy.host,
					depth: 0,
					httpStatus: null,
					contentType: null,
					outcome: "admission_rejected",
				}),
			);
			continue;
		}

		if (
			input.robotsState.robots != null &&
			!input.robotsState.robots.isAllowed(
				admission.normalizedUrl,
				buildRobotsUserAgent(input.bundle),
			)
		) {
			input.hostSummary.admissionRejected += 1;
			input.urlResults.push(
				buildOfficialWebUrlResultRecord({
					siteId: input.plan.siteId,
					crawlRunId: input.plan.crawlRunId,
					requestedUrl: candidate.url,
					finalUrl: null,
					declaredCanonicalUrl: null,
					normalizedCanonicalUrl: admission.normalizedUrl,
					urlIdentityBasis: null,
					discoveryMethod: candidate.discoveryMethod,
					discoveredFromUrl: candidate.discoveredFromUrl ?? null,
					host: input.hostPolicy.host,
					depth: 0,
					httpStatus: null,
					contentType: null,
					outcome: "robots_blocked",
				}),
			);
			continue;
		}

		const mergedKnownPages = mergeKnownPages(
			requests.get(admission.normalizedUrl)?.userData.knownPages,
			candidate.knownPages ?? (candidate.knownPage ? [candidate.knownPage] : []),
		);
		requests.set(admission.normalizedUrl, {
			url: admission.normalizedUrl,
			uniqueKey: admission.normalizedUrl,
			userData: {
				discoveryMethod: candidate.discoveryMethod,
				conditionalHeaders: buildConditionalHeaders(selectPrimaryKnownPage(mergedKnownPages), {
					disabled: input.disableConditionalHeaders,
				}),
				discoveredFromUrl: candidate.discoveredFromUrl ?? null,
				depth: 0,
				...(mergedKnownPages.length > 0
					? {
							knownPage: selectPrimaryKnownPage(mergedKnownPages),
							knownPages: mergedKnownPages,
						}
					: {}),
			},
		});
	}

	return [...requests.values()];
}

export function collectNavigationRequests(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	robotsState: CollectorRobotsState;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	depth: number;
	hostSummary: OfficialWebHostSummaryRecord;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }> {
	const requests = new Map<
		string,
		{ url: string; uniqueKey: string; userData: CollectorRequestUserData }
	>();
	const anchors = input.html("a[href]").toArray();

	for (const anchor of anchors) {
		const href = input.html(anchor).attr("href");
		if (typeof href !== "string" || href.length === 0) {
			continue;
		}

		let candidateUrl: string;
		try {
			candidateUrl = new URL(href, input.baseUrl).toString();
		} catch {
			continue;
		}

		const admission = admitOfficialWebUrl(input.bundle, {
			url: candidateUrl,
			discoveryMethod: "navigation",
			sourceHost: input.hostPolicy.host,
		});
		if (!admission.admitted || admission.normalizedUrl == null) {
			input.hostSummary.admissionRejected += 1;
			continue;
		}
		const knownPage = input.plannerPageLookup.get(admission.normalizedUrl);
		if (input.targetWorksetOnly && !knownPage) {
			input.hostSummary.admissionRejected += 1;
			continue;
		}
		if (
			input.robotsState.robots != null &&
			!input.robotsState.robots.isAllowed(
				admission.normalizedUrl,
				buildRobotsUserAgent(input.bundle),
			)
		) {
			input.hostSummary.admissionRejected += 1;
			continue;
		}

		requests.set(admission.normalizedUrl, {
			url: admission.normalizedUrl,
			uniqueKey: admission.normalizedUrl,
			userData: {
				discoveryMethod: "navigation",
				conditionalHeaders: buildConditionalHeaders(knownPage, {
					disabled: input.disableConditionalHeaders,
				}),
				discoveredFromUrl: input.baseUrl,
				depth: input.depth,
				knownPage,
				...(knownPage ? { knownPages: [knownPage] } : {}),
			},
		});
	}

	return [...requests.values()];
}

function mergeKnownPages(
	existing: OfficialWebPlannerPageCandidate[] | undefined,
	incoming: OfficialWebPlannerPageCandidate[],
): OfficialWebPlannerPageCandidate[] {
	const merged = new Map<string, OfficialWebPlannerPageCandidate>();
	for (const page of existing ?? []) {
		merged.set(buildKnownPageKey(page), page);
	}
	for (const page of incoming) {
		merged.set(buildKnownPageKey(page), page);
	}
	return [...merged.values()].sort((left, right) =>
		buildKnownPageKey(left).localeCompare(buildKnownPageKey(right)),
	);
}

function buildKnownPageKey(page: OfficialWebPlannerPageCandidate): string {
	return `${page.targetJobId}:${page.targetCandidateId ?? ""}:${page.targetId}`;
}

function selectPrimaryKnownPage(
	knownPages: OfficialWebPlannerPageCandidate[],
): OfficialWebPlannerPageCandidate | undefined {
	return knownPages[0];
}

export function buildConditionalHeaders(
	page: OfficialWebPlannerPageCandidate | undefined,
	options: { disabled?: boolean } = {},
):
	| {
			ifModifiedSince?: string;
			ifNoneMatch?: string;
	  }
	| undefined {
	if (!page || options.disabled) {
		return;
	}
	const headers: {
		ifModifiedSince?: string;
		ifNoneMatch?: string;
	} = {};
	if (page.etag) {
		headers.ifNoneMatch = page.etag;
	}
	if (page.lastModified) {
		headers.ifModifiedSince = page.lastModified;
	}
	return headers.ifNoneMatch || headers.ifModifiedSince ? headers : undefined;
}

async function loadSitemapUrls(urls: string[]): Promise<string[]> {
	if (urls.length === 0) {
		return [];
	}
	const sitemap = await Sitemap.load(urls);
	return sitemap.urls;
}
