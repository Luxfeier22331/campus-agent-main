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
	type OfficialWebDiscoveredLinkRecord,
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
			link.normalizedUrl === input.page.pageManifest.normalizedCanonicalUrl ||
			!shouldPromoteSourcePackExpansionLink(input.page, link)
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
		const inheritedTargetLineages = shouldInheritTargetLineagesFromPage(input.page, knownPage)
			? [...(input.page.pageManifest.targetMatches ?? [])]
			: undefined;
		if (input.targetWorksetOnly && !knownPage && !inheritedTargetLineages?.length) {
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
				...(inheritedTargetLineages ? { inheritedTargetLineages } : {}),
			},
		});

		if (requests.size >= maxPromotedLinks) {
			break;
		}
	}

	return [...requests.values()];
}

function shouldInheritTargetLineagesFromPage(
	page: CollectedPageArtifact,
	knownPage: OfficialWebPlannerPageCandidate | undefined,
): boolean {
	if (knownPage) {
		return false;
	}
	if (!isSourcePackExpansionRequeuePage(page)) {
		return false;
	}
	if (page.pageManifest.targetMatches == null || page.pageManifest.targetMatches.length === 0) {
		return false;
	}
	return page.pageManifest.targetMatches.every(
		(match) => match.sourcePackEntryId != null && match.sourcePackId != null,
	);
}

function shouldPromoteSourcePackExpansionLink(
	page: CollectedPageArtifact,
	link: OfficialWebDiscoveredLinkRecord,
): boolean {
	if (!isSourcePackExpansionRequeuePage(page)) {
		return true;
	}
	const targetMatches = page.pageManifest.targetMatches ?? [];
	if (!isRegulationPreviewSeedTargetMatches(targetMatches)) {
		return true;
	}
	return looksLikeRegulationDetailLink(page, link);
}

function isRegulationPreviewSeedTargetMatches(
	targetMatches: NonNullable<CollectedPageArtifact["pageManifest"]["targetMatches"]>,
): boolean {
	if (targetMatches.length === 0) {
		return false;
	}
	return targetMatches.every(
		(match) =>
			match.worksetReason === "source_pack_preview_seed" &&
			(match.consumerFamily === "regulation_candidate" ||
				match.consumerFamily === "student_regulation_candidate"),
	);
}

function looksLikeRegulationDetailLink(
	page: CollectedPageArtifact,
	link: OfficialWebDiscoveredLinkRecord,
): boolean {
	if (!link.normalizedUrl) {
		return false;
	}
	let pathname = "";
	try {
		pathname = new URL(link.normalizedUrl).pathname.toLowerCase();
	} catch {
		return false;
	}
	if (!/\.(?:htm|html)$/i.test(pathname)) {
		return false;
	}
	if (!mainContentLinkSet(page).has(link.normalizedUrl)) {
		return false;
	}

	const linkText = (link.linkText ?? "").trim();
	if (!linkText) {
		return false;
	}
	if (
		/(?:首页|主页|信息公开|干部人事|学生工作|公示公告|公告|公示|新闻|下载|跳转|办公地点|电话|邮箱|流程|结果)/u.test(
			linkText,
		)
	) {
		return false;
	}
	if (/(?:上页|下页|尾页|首页|上一页|下一页|\d{1,3})/u.test(linkText)) {
		return false;
	}
	return true;
}

function mainContentLinkSet(page: CollectedPageArtifact): Set<string> {
	return new Set(
		page.contentBlocks
			.filter((block) => block.blockRole === "link" && block.isMainContent && block.linkTarget)
			.map((block) => block.linkTarget as string),
	);
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
	const sourcePackExpansionPage = isSourcePackExpansionRequeuePage(input.page);
	if (!sourcePackExpansionPage && input.page.pageManifest.pageFamily !== "listing_page") {
		return false;
	}
	if (!input.knownPage) {
		return true;
	}
	if (sourcePackExpansionPage && input.knownPage.worksetReason === "source_pack_preview_seed") {
		return true;
	}

	return input.knownPage.mainContentHash !== input.page.pageManifest.mainContentHash;
}

function isSourcePackExpansionRequeuePage(page: CollectedPageArtifact): boolean {
	if (page.pageManifest.pageFamily === "listing_page") {
		return true;
	}
	if (page.pageManifest.pageFamily !== "directory_page") {
		return false;
	}
	const targetMatches = page.pageManifest.targetMatches ?? [];
	if (targetMatches.length === 0) {
		return false;
	}
	return targetMatches.every(
		(match) =>
			match.sourcePackId != null &&
			match.sourcePackEntryId != null &&
			match.worksetReason === "source_pack_preview_seed",
	);
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
