import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import { buildConditionalHeaders } from "./crawl-discovery-requests.ts";
import type { CollectorRequestUserData, CollectorRobotsState } from "./crawl-internal-types.ts";
import { buildRobotsUserAgent } from "./crawl-support.ts";
import type {
	OfficialWebDynamicShellDiscoverer,
	OfficialWebDynamicShellDiscovererOutput,
	OfficialWebDynamicShellDiscoveryAudit,
	OfficialWebDynamicShellDiscoveryResult,
} from "./dynamic-shell-discovery.ts";
import {
	buildOfficialWebFailureRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebFailureRecord,
	type OfficialWebHostPolicy,
	type OfficialWebHostSummaryRecord,
} from "./official-web-core.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export function buildListingRequeueRequests(input: {
	bundle: OfficialWebConfigBundle;
	depth: number;
	hostPolicy: OfficialWebHostPolicy;
	hostSummary: OfficialWebHostSummaryRecord;
	knownPage?: OfficialWebPlannerPageCandidate;
	page: CollectedPageArtifact;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	robotsState: CollectorRobotsState;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }> {
	if (!shouldPromoteListingRequeue({ knownPage: input.knownPage, page: input.page })) {
		return [];
	}

	const requests = new Map<
		string,
		{ url: string; uniqueKey: string; userData: CollectorRequestUserData }
	>();
	const maxPromotedLinks = Math.min(
		25,
		Math.max(5, Math.floor(input.page.discoveredLinks.length / 2)),
	);

	for (const link of input.page.discoveredLinks) {
		if (
			!(link.admitted && link.normalizedUrl) ||
			link.normalizedUrl === input.page.pageManifest.normalizedCanonicalUrl
		) {
			continue;
		}

		const targetHost = new URL(link.normalizedUrl).hostname.toLowerCase();
		if (targetHost !== input.hostPolicy.host) {
			continue;
		}
		if (
			input.robotsState.robots != null &&
			!input.robotsState.robots.isAllowed(link.normalizedUrl, buildRobotsUserAgent(input.bundle))
		) {
			input.hostSummary.admissionRejected += 1;
			continue;
		}

		const knownPage = input.plannerPageLookup.get(link.normalizedUrl);
		if (input.targetWorksetOnly && !knownPage) {
			input.hostSummary.admissionRejected += 1;
			continue;
		}
		requests.set(link.normalizedUrl, {
			url: link.normalizedUrl,
			uniqueKey: link.normalizedUrl,
			userData: {
				discoveryMethod: "manual_requeue",
				conditionalHeaders: buildConditionalHeaders(knownPage, {
					disabled: input.disableConditionalHeaders,
				}),
				discoveredFromUrl: input.page.pageManifest.normalizedCanonicalUrl,
				depth: input.depth,
				knownPage,
			},
		});

		if (requests.size >= maxPromotedLinks) {
			break;
		}
	}

	return [...requests.values()];
}

export async function buildDynamicShellRequeueRequests(input: {
	bundle: OfficialWebConfigBundle;
	depth: number;
	dynamicShellDiscoverer: OfficialWebDynamicShellDiscoverer;
	failures: OfficialWebFailureRecord[];
	hostPolicy: OfficialWebHostPolicy;
	hostSummary: OfficialWebHostSummaryRecord;
	page: CollectedPageArtifact;
	plan: OfficialWebCrawlPlan;
	plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
	robotsState: CollectorRobotsState;
	targetWorksetOnly?: boolean;
	disableConditionalHeaders?: boolean;
}): Promise<{
	requests: Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }>;
	audits: OfficialWebDynamicShellDiscoveryAudit[];
}> {
	if (
		input.page.pageManifest.pageFamily !== "dynamic_shell_page" ||
		!input.hostPolicy.dynamicShellDiscovery?.enabled
	) {
		return { requests: [], audits: [] };
	}

	try {
		const discoveryResult = normalizeDynamicShellDiscovererOutput(
			await input.dynamicShellDiscoverer({
				bundle: input.bundle,
				hostPolicy: input.hostPolicy,
				page: input.page,
			}),
		);
		if (discoveryResult.promotedUrls.length === 0) {
			return {
				requests: [],
				audits: discoveryResult.audit.sourceUrl.length > 0 ? [discoveryResult.audit] : [],
			};
		}

		const requests = new Map<
			string,
			{ url: string; uniqueKey: string; userData: CollectorRequestUserData }
		>();
		for (const url of discoveryResult.promotedUrls) {
			if (url === input.page.pageManifest.normalizedCanonicalUrl) {
				continue;
			}
			const targetHost = new URL(url).hostname.toLowerCase();
			if (targetHost !== input.hostPolicy.host) {
				continue;
			}
			if (
				input.robotsState.robots != null &&
				!input.robotsState.robots.isAllowed(url, buildRobotsUserAgent(input.bundle))
			) {
				input.hostSummary.admissionRejected += 1;
				continue;
			}

			const knownPage = input.plannerPageLookup.get(url);
			if (input.targetWorksetOnly && !knownPage) {
				input.hostSummary.admissionRejected += 1;
				continue;
			}
			requests.set(url, {
				url,
				uniqueKey: url,
				userData: {
					discoveryMethod: "manual_requeue",
					conditionalHeaders: buildConditionalHeaders(knownPage, {
						disabled: input.disableConditionalHeaders,
					}),
					discoveredFromUrl: input.page.pageManifest.normalizedCanonicalUrl,
					depth: input.depth,
					knownPage,
				},
			});
			if (requests.size >= input.hostPolicy.dynamicShellDiscovery.maxPromotedUrls) {
				break;
			}
		}

		return {
			requests: [...requests.values()],
			audits: discoveryResult.audit.sourceUrl.length > 0 ? [discoveryResult.audit] : [],
		};
	} catch (error) {
		input.hostSummary.failures += 1;
		input.failures.push(
			buildOfficialWebFailureRecord({
				siteId: input.plan.siteId,
				crawlRunId: input.plan.crawlRunId,
				host: input.hostPolicy.host,
				url: input.page.pageManifest.normalizedCanonicalUrl,
				phase: "process",
				reason: "dynamic_shell_discovery_failed",
				message: String(error instanceof Error ? error.message : error),
				retryable: true,
			}),
		);
		return { requests: [], audits: [] };
	}
}

export function isRepairableStatusCode(statusCode: number | null): boolean {
	return statusCode === 429 || (statusCode != null && statusCode >= 500);
}

function shouldPromoteListingRequeue(input: {
	knownPage?: OfficialWebPlannerPageCandidate;
	page: CollectedPageArtifact;
}): boolean {
	if (input.page.pageManifest.pageFamily !== "listing_page") {
		return false;
	}
	if (!input.knownPage) {
		return true;
	}

	return input.knownPage.mainContentHash !== input.page.pageManifest.mainContentHash;
}

function normalizeDynamicShellDiscovererOutput(
	output: OfficialWebDynamicShellDiscovererOutput,
): OfficialWebDynamicShellDiscoveryResult {
	if (!Array.isArray(output)) {
		return output;
	}

	return {
		promotedUrls: output,
		audit: {
			sourceUrl: "",
			host: "",
			wait: {
				waitAfterLoadMs: 0,
				networkObservationTimeoutMs: 0,
				matchedResponseUrl: null,
				matchedSelector: null,
				usedNetworkIdleFallback: false,
				usedFixedDelayFallback: false,
			},
			captures: [],
			extractedUrls: output,
			resolvedUrls: output,
			admissions: [],
			promotedUrls: output,
		},
	};
}
