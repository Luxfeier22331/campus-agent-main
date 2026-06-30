import { type CheerioCrawlingContext, Sitemap } from "crawlee";
import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import type { CollectorRequestUserData, CollectorRobotsState } from "./crawl-internal-types.ts";
import { buildRobotsUserAgent } from "./crawl-support.ts";
import {
	admitOfficialWebUrl,
	buildOfficialWebFailureRecord,
	buildOfficialWebUrlResultRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebFailureRecord,
	type OfficialWebHostPolicy,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "./official-web-core.ts";

export interface InitialRequestDiscoveryResult {
	failures: OfficialWebFailureRecord[];
	requests: Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }>;
}

export async function buildInitialRequests(input: {
	bundle: OfficialWebConfigBundle;
	plan: OfficialWebCrawlPlan;
	hostPolicy: OfficialWebHostPolicy;
	plannerPages: OfficialWebPlannerPageCandidate[];
	robotsState: CollectorRobotsState;
	hostSummary: OfficialWebHostSummaryRecord;
	urlResults: OfficialWebUrlResultRecord[];
	disableConditionalHeaders?: boolean;
}): Promise<InitialRequestDiscoveryResult> {
	const candidates: Array<{
		url: string;
		discoveryMethod: CollectorRequestUserData["discoveryMethod"];
		discoveredFromUrl?: string | null;
		knownPage?: OfficialWebPlannerPageCandidate;
		knownPages?: OfficialWebPlannerPageCandidate[];
	}> = [];

	for (const page of input.plannerPages) {
		candidates.push({
			url: page.normalizedCanonicalUrl,
			discoveryMethod: page.discoveryMethod,
			discoveredFromUrl: page.discoveredFromUrl,
			knownPage: page,
		});
	}
	const failures = await appendSitemapCandidates({
		...input,
		candidates,
	});

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

		const existingRequest = requests.get(admission.normalizedUrl);
		const incomingKnownPages =
			candidate.knownPages ?? (candidate.knownPage ? [candidate.knownPage] : []);
		if (existingRequest && incomingKnownPages.length === 0) {
			continue;
		}
		const mergedKnownPages = mergeKnownPages(
			existingRequest?.userData.knownPages,
			incomingKnownPages,
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

	return {
		failures,
		requests: [...requests.values()],
	};
}

async function appendSitemapCandidates(input: {
	bundle: OfficialWebConfigBundle;
	candidates: Array<{
		url: string;
		discoveryMethod: CollectorRequestUserData["discoveryMethod"];
		discoveredFromUrl?: string | null;
		knownPage?: OfficialWebPlannerPageCandidate;
		knownPages?: OfficialWebPlannerPageCandidate[];
	}>;
	hostPolicy: OfficialWebHostPolicy;
	plan: OfficialWebCrawlPlan;
	robotsState: CollectorRobotsState;
}): Promise<OfficialWebFailureRecord[]> {
	const failures: OfficialWebFailureRecord[] = [];
	const robotsUrl = `https://${input.hostPolicy.host}/robots.txt`;
	if (input.robotsState.robots != null) {
		try {
			for (const url of await input.robotsState.robots.parseUrlsFromSitemaps()) {
				input.candidates.push({
					url,
					discoveryMethod: "robots_sitemap",
					discoveredFromUrl: robotsUrl,
				});
			}
		} catch (error) {
			failures.push(
				buildOfficialWebFailureRecord({
					siteId: input.plan.siteId,
					crawlRunId: input.plan.crawlRunId,
					host: input.hostPolicy.host,
					url: robotsUrl,
					phase: "sitemap",
					reason: "robots_sitemap_parse_failed",
					message: formatErrorWithCauses(error),
					retryable: true,
				}),
			);
		}
	}
	if (input.hostPolicy.explicitSitemaps.length > 0) {
		try {
			const sitemap = await Sitemap.load(input.hostPolicy.explicitSitemaps);
			for (const url of sitemap.urls) {
				input.candidates.push({
					url,
					discoveryMethod: "configured_sitemap",
					discoveredFromUrl: null,
				});
			}
		} catch (error) {
			failures.push(
				buildOfficialWebFailureRecord({
					siteId: input.plan.siteId,
					crawlRunId: input.plan.crawlRunId,
					host: input.hostPolicy.host,
					url: input.hostPolicy.explicitSitemaps.join(","),
					phase: "sitemap",
					reason: "configured_sitemap_parse_failed",
					message: formatErrorWithCauses(error),
					retryable: true,
				}),
			);
		}
	}
	return failures;
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

function formatErrorWithCauses(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}

	const parts = [error.message];
	let currentCause = error.cause;
	while (currentCause != null) {
		if (currentCause instanceof Error) {
			parts.push(currentCause.message);
			currentCause = currentCause.cause;
			continue;
		}
		parts.push(String(currentCause));
		break;
	}

	return parts.join(" | caused by: ");
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
