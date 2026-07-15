import type { CheerioCrawlingContext, RequestOptions } from "crawlee";
import {
	admitOfficialWebUrl,
	buildOfficialWebUrlResultRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebHostPolicy,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "./core/index.ts";
import type { OfficialWebCrawlCandidate as OfficialWebPlannerPageCandidate } from "./crawl-candidates.ts";
import type { CollectorRequestUserData } from "./crawl-internal-types.ts";

export interface InitialRequestDiscoveryResult {
	requests: RequestOptions<CollectorRequestUserData>[];
}

export function buildInitialRequests(input: {
	bundle: OfficialWebConfigBundle;
	plan: OfficialWebCrawlPlan;
	hostPolicy: OfficialWebHostPolicy;
	plannerPages: OfficialWebPlannerPageCandidate[];
	hostSummary: OfficialWebHostSummaryRecord;
	urlResults: OfficialWebUrlResultRecord[];
	disableConditionalHeaders?: boolean;
}): InitialRequestDiscoveryResult {
	const candidates: Array<{
		url: string;
		configuredSeedUrl?: string | null;
		discoveryMethod: CollectorRequestUserData["discoveryMethod"];
		discoveredFromUrl?: string | null;
		knownPage?: OfficialWebPlannerPageCandidate;
		knownPages?: OfficialWebPlannerPageCandidate[];
	}> = [];

	for (const page of input.plannerPages) {
		candidates.push({
			url: page.normalizedCanonicalUrl,
			configuredSeedUrl: page.configuredSeedUrl ?? null,
			discoveryMethod: page.discoveryMethod,
			discoveredFromUrl: page.discoveredFromUrl,
			knownPage: page,
		});
	}

	const requests = new Map<string, RequestOptions<CollectorRequestUserData>>();
	for (const candidate of candidates) {
		const request = buildAdmittedCollectorRequest({
			bundle: input.bundle,
			candidate,
			depth: 0,
			disableConditionalHeaders: input.disableConditionalHeaders,
			hostPolicy: input.hostPolicy,
			hostSummary: input.hostSummary,
			plan: input.plan,
			urlResults: input.urlResults,
		});
		if (!request) {
			continue;
		}
		const requestUserData = request.userData;
		if (!requestUserData) {
			throw new Error("official-web admitted collector request must include userData");
		}

		const existingRequest = requests.get(request.url);
		const incomingKnownPages =
			candidate.knownPages ?? (candidate.knownPage ? [candidate.knownPage] : []);
		if (existingRequest && incomingKnownPages.length === 0) {
			continue;
		}
		const mergedKnownPages = mergeKnownPages(
			existingRequest?.userData?.knownPages,
			incomingKnownPages,
		);
		requests.set(request.url, {
			...request,
			userData: {
				configuredSeedUrl: requestUserData.configuredSeedUrl ?? null,
				discoveryMethod: requestUserData.discoveryMethod,
				discoveredFromUrl: requestUserData.discoveredFromUrl,
				depth: requestUserData.depth,
				inheritedTargetLineages: requestUserData.inheritedTargetLineages,
				conditionalHeaders: buildConditionalHeaders(selectPrimaryKnownPage(mergedKnownPages), {
					disabled: input.disableConditionalHeaders,
				}),
				...(mergedKnownPages.length > 0
					? {
							knownPage: selectPrimaryKnownPage(mergedKnownPages),
							knownPages: mergedKnownPages,
						}
					: {}),
			},
		});
	}

	return {
		requests: [...requests.values()],
	};
}

export function transformNavigationRequest(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	hostSummary: OfficialWebHostSummaryRecord;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	request: RequestOptions;
	baseUrl: string;
	depth: number;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): RequestOptions<CollectorRequestUserData> | false {
	const candidateUrl = input.request.url;
	const admission = admitOfficialWebUrl(input.bundle, {
		url: candidateUrl,
		discoveryMethod: "navigation",
		sourceHost: input.hostPolicy.host,
	});
	if (!admission.admitted || admission.normalizedUrl == null) {
		input.hostSummary.admissionRejected += 1;
		return false;
	}
	const knownPage = input.plannerPageLookup.get(admission.normalizedUrl);
	if (input.targetWorksetOnly && !knownPage) {
		input.hostSummary.admissionRejected += 1;
		return false;
	}

	return {
		...input.request,
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
	};
}

function buildAdmittedCollectorRequest(input: {
	bundle: OfficialWebConfigBundle;
	candidate: {
		url: string;
		configuredSeedUrl?: string | null;
		discoveryMethod: CollectorRequestUserData["discoveryMethod"];
		discoveredFromUrl?: string | null;
		knownPage?: OfficialWebPlannerPageCandidate;
		knownPages?: OfficialWebPlannerPageCandidate[];
	};
	depth: number;
	disableConditionalHeaders?: boolean;
	hostPolicy: OfficialWebHostPolicy;
	hostSummary: OfficialWebHostSummaryRecord;
	plan: OfficialWebCrawlPlan;
	urlResults: OfficialWebUrlResultRecord[];
}): RequestOptions<CollectorRequestUserData> | null {
	const admission = admitOfficialWebUrl(input.bundle, {
		url: input.candidate.url,
		discoveryMethod: input.candidate.discoveryMethod,
	});
	if (!admission.admitted || admission.normalizedUrl == null) {
		input.hostSummary.admissionRejected += 1;
		input.urlResults.push(
			buildOfficialWebUrlResultRecord({
				siteId: input.plan.siteId,
				crawlRunId: input.plan.crawlRunId,
				requestedUrl: input.candidate.url,
				finalUrl: null,
				declaredCanonicalUrl: null,
				normalizedCanonicalUrl: null,
				urlIdentityBasis: null,
				discoveryMethod: input.candidate.discoveryMethod,
				discoveredFromUrl: input.candidate.discoveredFromUrl ?? null,
				host: input.hostPolicy.host,
				depth: input.depth,
				httpStatus: null,
				contentType: null,
				outcome: "admission_rejected",
			}),
		);
		return null;
	}

	const incomingKnownPages =
		input.candidate.knownPages ?? (input.candidate.knownPage ? [input.candidate.knownPage] : []);

	return {
		url: admission.normalizedUrl,
		uniqueKey: admission.normalizedUrl,
		userData: {
			configuredSeedUrl: input.candidate.configuredSeedUrl ?? null,
			discoveryMethod: input.candidate.discoveryMethod,
			conditionalHeaders: buildConditionalHeaders(selectPrimaryKnownPage(incomingKnownPages), {
				disabled: input.disableConditionalHeaders,
			}),
			discoveredFromUrl: input.candidate.discoveredFromUrl ?? null,
			depth: input.depth,
			...(incomingKnownPages.length > 0
				? {
						knownPage: selectPrimaryKnownPage(incomingKnownPages),
						knownPages: incomingKnownPages,
					}
				: {}),
		},
	};
}

export function buildConfiguredSitemapRequestTransform(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	hostSummary: OfficialWebHostSummaryRecord;
	plan: OfficialWebCrawlPlan;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	urlResults: OfficialWebUrlResultRecord[];
	disableConditionalHeaders?: boolean;
}): (request: RequestOptions) => RequestOptions<CollectorRequestUserData> | false {
	return (request) => {
		const knownPage = input.plannerPageLookup.get(request.url);
		const admitted = buildAdmittedCollectorRequest({
			bundle: input.bundle,
			candidate: {
				url: request.url,
				discoveryMethod: knownPage?.discoveryMethod ?? "configured_sitemap",
				discoveredFromUrl: null,
				knownPage,
			},
			depth: 0,
			disableConditionalHeaders: input.disableConditionalHeaders,
			hostPolicy: input.hostPolicy,
			hostSummary: input.hostSummary,
			plan: input.plan,
			urlResults: input.urlResults,
		});
		return admitted ?? false;
	};
}

export function collectNavigationRequests(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	depth: number;
	hostSummary: OfficialWebHostSummaryRecord;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): RequestOptions<CollectorRequestUserData>[] {
	const requests = new Map<string, RequestOptions<CollectorRequestUserData>>();
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

		const request = transformNavigationRequest({
			bundle: input.bundle,
			hostPolicy: input.hostPolicy,
			hostSummary: input.hostSummary,
			plannerPageLookup: input.plannerPageLookup,
			request: { url: candidateUrl },
			baseUrl: input.baseUrl,
			depth: input.depth,
			targetWorksetOnly: input.targetWorksetOnly,
			disableConditionalHeaders: input.disableConditionalHeaders,
		});
		if (request) {
			requests.set(request.url, request);
		}
	}

	return [...requests.values()];
}

export function isAdmittedNavigationRequest(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	url: string;
}): boolean {
	const admission = admitOfficialWebUrl(input.bundle, {
		url: input.url,
		discoveryMethod: "navigation",
		sourceHost: input.hostPolicy.host,
	});
	return admission.admitted;
}

/*
 * Kept for focused unit tests that assert admission behavior independent of
 * Crawlee's Cheerio context-aware enqueueLinks implementation.
 */
export function buildNavigationRequestsForTest(input: {
	bundle: OfficialWebConfigBundle;
	hostPolicy: OfficialWebHostPolicy;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	depth: number;
	hostSummary: OfficialWebHostSummaryRecord;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): RequestOptions<CollectorRequestUserData>[] {
	return collectNavigationRequests(input);
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
