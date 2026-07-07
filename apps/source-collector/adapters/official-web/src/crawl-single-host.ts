import {
	CheerioCrawler,
	type Configuration,
	type RequestOptions,
	RequestQueue,
	SitemapRequestList,
} from "crawlee";
import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import {
	buildOfficialWebFailureRecord,
	buildOfficialWebUrlIdentity,
	buildOfficialWebUrlResultRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebFailureRecord,
	type OfficialWebHostPolicy,
	type OfficialWebHostSummaryRecord,
	type OfficialWebPageObservationRecord,
	type OfficialWebPageTargetMatch,
	type OfficialWebUrlResultRecord,
} from "./core/index.ts";
import {
	buildConfiguredSitemapRequestTransform,
	buildDynamicShellRequeueRequests,
	buildInitialRequests,
	buildListingRequeueRequests,
	isRepairableStatusCode,
	transformNavigationRequest,
} from "./crawl-discovery.ts";
import type {
	CollectorHostCrawlResult,
	CollectorRequestUserData,
	CollectorSourcePackLineageOverride,
} from "./crawl-internal-types.ts";
import {
	buildKnownPageObservation,
	buildPageObservationFromCollectedPage,
} from "./crawl-observations.ts";
import {
	buildHostRequestQueueName,
	buildRobotsUserAgent,
	extractDeclaredCanonicalUrl,
	resolveResponseBody,
	resolveUrlOutcome,
} from "./crawl-support.ts";
import {
	discoverDynamicShellPromotedUrls,
	type OfficialWebDynamicShellDiscoverer,
	type OfficialWebDynamicShellDiscoveryAudit,
} from "./dynamic-shell-discovery.ts";
import { buildCollectedPageArtifacts, type CollectedPageArtifact } from "./page-artifacts.ts";

export interface CrawlSingleHostInput {
	bundle: OfficialWebConfigBundle;
	plan: OfficialWebCrawlPlan;
	hostPolicy: OfficialWebHostPolicy;
	config: Configuration;
	plannerPages: OfficialWebPlannerPageCandidate[];
	maxPagesForHost: number;
	dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
	disableConditionalHeaders?: boolean;
	sourcePackLineageOverrides?: Record<string, CollectorSourcePackLineageOverride>;
}

export async function crawlSingleHost(
	input: CrawlSingleHostInput,
): Promise<CollectorHostCrawlResult> {
	const hostSummary: OfficialWebHostSummaryRecord = {
		host: input.hostPolicy.host,
		pagesObserved: 0,
		pagesFetched: 0,
		failures: 0,
		admissionRejected: 0,
		robotsBlocked: false,
	};
	const pageObservations: OfficialWebPageObservationRecord[] = [];
	const urlResults: OfficialWebUrlResultRecord[] = [];
	const failures: OfficialWebFailureRecord[] = [];
	const pages: CollectedPageArtifact[] = [];
	const dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[] = [];
	const plannerPageLookup = new Map(
		input.plannerPages.map((page) => [page.normalizedCanonicalUrl, page] as const),
	);

	const seedDiscovery = buildInitialRequests({
		bundle: input.bundle,
		plan: input.plan,
		hostPolicy: input.hostPolicy,
		plannerPages: input.plannerPages,
		hostSummary,
		urlResults,
		disableConditionalHeaders: input.disableConditionalHeaders,
	});
	const seedRequests = seedDiscovery.requests;
	if (seedRequests.length === 0 && input.hostPolicy.explicitSitemaps.length === 0) {
		return {
			hostSummaries: [hostSummary],
			pageObservations,
			urlResults,
			failures,
			pages,
			dynamicShellDiscoveryAudits,
			completed: true,
		};
	}

	const requestQueue = await RequestQueue.open(
		buildHostRequestQueueName(input.plan.crawlRunId, input.hostPolicy.host),
		{ config: input.config },
	);
	const sitemapTransform = buildConfiguredSitemapRequestTransform({
		bundle: input.bundle,
		hostPolicy: input.hostPolicy,
		hostSummary,
		plan: input.plan,
		plannerPageLookup,
		urlResults,
		disableConditionalHeaders: input.disableConditionalHeaders,
	});
	const sitemapRequests = await loadConfiguredSitemapRequests({
		config: input.config,
		hostPolicy: input.hostPolicy,
		requestTimeoutMs: input.bundle.site.requestTimeoutMs,
		transform: sitemapTransform,
	});
	const initialRequests = mergeInitialRequests(seedRequests, sitemapRequests);
	if (initialRequests.length === 0) {
		return {
			hostSummaries: [hostSummary],
			pageObservations,
			urlResults,
			failures,
			pages,
			dynamicShellDiscoveryAudits,
			completed: true,
		};
	}
	const requestUserDataByUrl = new Map(
		initialRequests.map((request) => [request.url, request.userData] as const),
	);
	const crawler = new CheerioCrawler(
		{
			requestQueue,
			maxConcurrency: input.hostPolicy.maxConcurrency,
			maxRequestsPerCrawl: input.maxPagesForHost,
			sameDomainDelaySecs: input.hostPolicy.minDelayMs / 1000,
			requestHandlerTimeoutSecs: input.bundle.site.requestHandlerTimeoutMs / 1000,
			navigationTimeoutSecs: input.bundle.site.requestTimeoutMs / 1000,
			maxRequestRetries: input.bundle.site.maxRequestRetries,
			respectRobotsTxtFile: input.hostPolicy.respectRobots
				? { userAgent: buildRobotsUserAgent(input.bundle) }
				: false,
			additionalHttpErrorStatusCodes: [429],
			additionalMimeTypes: ["application/octet-stream"],
			ignoreSslErrors: false,
			onSkippedRequest: async ({ url, reason }) => {
				if (reason !== "robotsTxt") {
					return;
				}
				hostSummary.robotsBlocked = true;
				hostSummary.admissionRejected += 1;
				urlResults.push(
					buildOfficialWebUrlResultRecord({
						siteId: input.plan.siteId,
						crawlRunId: input.plan.crawlRunId,
						requestedUrl: url,
						finalUrl: null,
						declaredCanonicalUrl: null,
						normalizedCanonicalUrl: url,
						urlIdentityBasis: null,
						discoveryMethod: requestUserDataByUrl.get(url)?.discoveryMethod ?? "configured_sitemap",
						discoveredFromUrl: requestUserDataByUrl.get(url)?.discoveredFromUrl ?? null,
						host: input.hostPolicy.host,
						depth: requestUserDataByUrl.get(url)?.depth ?? 0,
						httpStatus: null,
						contentType: null,
						outcome: "robots_blocked",
					}),
				);
			},
			preNavigationHooks: [
				async (ctx, gotOptions) => {
					const userData = ctx.request.userData as CollectorRequestUserData;
					gotOptions.headers ??= {};
					gotOptions.headers["user-agent"] = input.bundle.site.userAgent;
					gotOptions.headers.accept = "text/html,application/xhtml+xml";
					if (userData.conditionalHeaders?.ifNoneMatch) {
						gotOptions.headers["if-none-match"] = userData.conditionalHeaders.ifNoneMatch;
					}
					if (userData.conditionalHeaders?.ifModifiedSince) {
						gotOptions.headers["if-modified-since"] = userData.conditionalHeaders.ifModifiedSince;
					}
				},
			],
			async requestHandler(context) {
				const userData = context.request.userData as CollectorRequestUserData;
				const knownPages = resolveKnownPages(userData);
				const knownPage = knownPages[0];
				const finalUrl = context.request.loadedUrl ?? context.response.url ?? context.request.url;
				const resultHost = new URL(finalUrl).hostname.toLowerCase();
				const declaredCanonicalUrl = extractDeclaredCanonicalUrl(context);
				const urlIdentity = buildOfficialWebUrlIdentity(input.bundle, {
					requestedUrl: context.request.url,
					finalUrl,
					declaredCanonicalUrl,
				});
				const httpStatus = context.response.statusCode ?? null;
				const contentType = context.contentType.type ?? null;
				const outcome = resolveUrlOutcome(httpStatus, contentType ?? "");

				hostSummary.pagesObserved += 1;
				if (outcome === "fetched") {
					hostSummary.pagesFetched += 1;
				}

				urlResults.push(
					buildOfficialWebUrlResultRecord({
						siteId: input.plan.siteId,
						crawlRunId: input.plan.crawlRunId,
						requestedUrl: context.request.url,
						finalUrl,
						declaredCanonicalUrl,
						normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
						urlIdentityBasis: urlIdentity.urlIdentityBasis,
						discoveryMethod: userData.discoveryMethod,
						discoveredFromUrl: userData.discoveredFromUrl,
						host: resultHost,
						depth: userData.depth,
						httpStatus,
						contentType,
						outcome,
					}),
				);

				if (outcome === "fetched") {
					try {
						const pageArtifact = buildCollectedPageArtifacts({
							bundle: input.bundle,
							plan: input.plan,
							hostPolicy: input.hostPolicy,
							requestedUrl: context.request.url,
							finalUrl,
							declaredCanonicalUrl,
							responseBody: resolveResponseBody(context),
							responseHeaders: context.response.headers as Record<
								string,
								string | string[] | undefined
							>,
							httpStatus: httpStatus ?? 200,
							contentType: contentType ?? "text/html",
							discoveryMethod: userData.discoveryMethod,
							discoveredFromUrl: userData.discoveredFromUrl,
							fetchedAt: new Date().toISOString(),
							targetLineages: buildTargetLineages(
								knownPages,
								userData.inheritedTargetLineages,
								input.sourcePackLineageOverrides,
							),
							html: context.$,
						});
						pages.push(pageArtifact);
						pageObservations.push(
							buildPageObservationFromCollectedPage(
								input.plan.siteId,
								input.plan.crawlRunId,
								input.plan.runIntent,
								pageArtifact,
							),
						);

						const promotedRequests = buildListingRequeueRequests({
							bundle: input.bundle,
							hostPolicy: input.hostPolicy,
							hostSummary,
							knownPage,
							plannerPageLookup,
							page: pageArtifact,
							depth: Math.min(userData.depth + 1, input.hostPolicy.maxDepth),
							targetWorksetOnly: true,
							disableConditionalHeaders: input.disableConditionalHeaders,
						});
						const dynamicShellRequests = await buildDynamicShellRequeueRequests({
							bundle: input.bundle,
							failures,
							hostPolicy: input.hostPolicy,
							hostSummary,
							plan: input.plan,
							plannerPageLookup,
							page: pageArtifact,
							depth: Math.min(userData.depth + 1, input.hostPolicy.maxDepth),
							targetWorksetOnly: true,
							disableConditionalHeaders: input.disableConditionalHeaders,
							dynamicShellDiscoverer:
								input.dynamicShellDiscoverer ?? discoverDynamicShellPromotedUrls,
						});
						dynamicShellDiscoveryAudits.push(...dynamicShellRequests.audits);
						const requeueRequests = [...promotedRequests, ...dynamicShellRequests.requests];
						if (requeueRequests.length > 0) {
							await context.crawler.addRequests(requeueRequests, {
								forefront: shouldPrioritizeManualRequeue(knownPage),
							});
						}
					} catch (error) {
						hostSummary.failures += 1;
						failures.push(
							buildOfficialWebFailureRecord({
								siteId: input.plan.siteId,
								crawlRunId: input.plan.crawlRunId,
								host: input.hostPolicy.host,
								url: finalUrl,
								phase: "process",
								reason: "page_artifact_build_failed",
								message: String(error instanceof Error ? error.message : error),
								retryable: false,
							}),
						);
						if (knownPage) {
							pageObservations.push(
								buildKnownPageObservation({
									crawlRunId: input.plan.crawlRunId,
									knownPage,
									observedAt: new Date().toISOString(),
									requestedUrl: context.request.url,
									finalUrl,
									disposition: "fetch_failed",
									httpStatus,
									runIntent: input.plan.runIntent,
								}),
							);
						}
					}
				} else if (knownPage && (outcome === "not_modified" || outcome === "deleted")) {
					pageObservations.push(
						buildKnownPageObservation({
							crawlRunId: input.plan.crawlRunId,
							knownPage,
							observedAt: new Date().toISOString(),
							requestedUrl: context.request.url,
							finalUrl,
							disposition: outcome,
							httpStatus,
							runIntent: input.plan.runIntent,
						}),
					);
				} else if (knownPage && isRepairableStatusCode(httpStatus)) {
					hostSummary.failures += 1;
					failures.push(
						buildOfficialWebFailureRecord({
							siteId: input.plan.siteId,
							crawlRunId: input.plan.crawlRunId,
							host: input.hostPolicy.host,
							url: finalUrl,
							phase: "fetch",
							reason: `http_status_${httpStatus ?? "unknown"}`,
							message: `page fetch returned ${httpStatus ?? "unknown"}`,
							retryable: true,
						}),
					);
					pageObservations.push(
						buildKnownPageObservation({
							crawlRunId: input.plan.crawlRunId,
							knownPage,
							observedAt: new Date().toISOString(),
							requestedUrl: context.request.url,
							finalUrl,
							disposition: "fetch_failed",
							httpStatus,
							runIntent: input.plan.runIntent,
						}),
					);
				}

				if (
					outcome !== "fetched" ||
					userData.discoveryMethod === "manual_requeue" ||
					userData.depth >= input.hostPolicy.maxDepth ||
					resultHost !== input.hostPolicy.host
				) {
					return;
				}

				await context.enqueueLinks({
					strategy: "same-hostname",
					transformRequestFunction: (request) =>
						transformNavigationRequest({
							bundle: input.bundle,
							hostPolicy: input.hostPolicy,
							hostSummary,
							plannerPageLookup,
							request,
							baseUrl: finalUrl,
							depth: userData.depth + 1,
							targetWorksetOnly: true,
							disableConditionalHeaders: input.disableConditionalHeaders,
						}),
				});
			},
			async failedRequestHandler(context, error) {
				const userData = context.request.userData as CollectorRequestUserData;
				hostSummary.failures += 1;
				failures.push(
					buildOfficialWebFailureRecord({
						siteId: input.plan.siteId,
						crawlRunId: input.plan.crawlRunId,
						host: input.hostPolicy.host,
						url: context.request.url,
						phase: "fetch",
						reason: "request_failed",
						message: String(error instanceof Error ? error.message : error),
						retryable: false,
					}),
				);
				if (userData.knownPage) {
					pageObservations.push(
						buildKnownPageObservation({
							crawlRunId: input.plan.crawlRunId,
							knownPage: userData.knownPage,
							observedAt: new Date().toISOString(),
							requestedUrl: context.request.url,
							finalUrl: context.request.url,
							disposition: "fetch_failed",
							httpStatus: null,
							runIntent: input.plan.runIntent,
						}),
					);
				}
			},
		},
		input.config,
	);

	await crawler.run(initialRequests);

	return {
		hostSummaries: [hostSummary],
		pageObservations,
		urlResults,
		failures,
		pages,
		dynamicShellDiscoveryAudits,
		completed: true,
	};
}

function buildTargetLineage(
	knownPage: OfficialWebPlannerPageCandidate | undefined,
	sourcePackLineageOverrides?: Record<string, CollectorSourcePackLineageOverride>,
): OfficialWebPageTargetMatch | undefined {
	if (!knownPage) {
		return;
	}
	const sourcePackLineage = resolveSourcePackLineageOverride(knownPage, sourcePackLineageOverrides);

	return {
		sourcePackId: sourcePackLineage?.sourcePackId,
		sourcePackEntryId: sourcePackLineage?.sourcePackEntryId,
		compositionGroup: sourcePackLineage?.compositionGroup,
		compositionRole: sourcePackLineage?.compositionRole,
		targetJobId: knownPage.targetJobId,
		targetCandidateId: knownPage.targetCandidateId,
		targetId: knownPage.targetId,
		targetDeclarationVersion: knownPage.targetDeclarationVersion,
		consumerFamily: knownPage.consumerFamily as OfficialWebPageTargetMatch["consumerFamily"],
		retentionPolicy: knownPage.retentionPolicy as OfficialWebPageTargetMatch["retentionPolicy"],
		materializationPolicy:
			knownPage.materializationPolicy as OfficialWebPageTargetMatch["materializationPolicy"],
		selectedWriteTarget: knownPage.selectedWriteTarget,
		reviewPolicy: knownPage.reviewPolicy,
		worksetReason: knownPage.worksetReason,
	};
}

function buildTargetLineages(
	knownPages: OfficialWebPlannerPageCandidate[],
	inheritedTargetLineages: OfficialWebPageTargetMatch[] | undefined,
	sourcePackLineageOverrides?: Record<string, CollectorSourcePackLineageOverride>,
): OfficialWebPageTargetMatch[] | undefined {
	if (knownPages.length === 0) {
		return inheritedTargetLineages != null && inheritedTargetLineages.length > 0
			? inheritedTargetLineages
			: undefined;
	}
	const derived = knownPages
		.map((page) => buildTargetLineage(page, sourcePackLineageOverrides))
		.filter((item): item is OfficialWebPageTargetMatch => item != null);
	if (inheritedTargetLineages == null || inheritedTargetLineages.length === 0) {
		return derived.length > 0 ? derived : undefined;
	}
	const merged = new Map<string, OfficialWebPageTargetMatch>();
	for (const lineage of [...derived, ...inheritedTargetLineages]) {
		merged.set(
			`${lineage.targetJobId}:${lineage.targetCandidateId ?? ""}:${lineage.targetId}`,
			lineage,
		);
	}
	return [...merged.values()];
}

function resolveSourcePackLineageOverride(
	knownPage: OfficialWebPlannerPageCandidate,
	sourcePackLineageOverrides?: Record<string, CollectorSourcePackLineageOverride>,
): CollectorSourcePackLineageOverride | undefined {
	if (!sourcePackLineageOverrides) {
		return;
	}
	const candidateId = knownPage.targetCandidateId?.trim();
	if (!candidateId) {
		return;
	}
	return sourcePackLineageOverrides[candidateId];
}

function resolveKnownPages(userData: CollectorRequestUserData): OfficialWebPlannerPageCandidate[] {
	if (Array.isArray(userData.knownPages) && userData.knownPages.length > 0) {
		return userData.knownPages;
	}
	return userData.knownPage ? [userData.knownPage] : [];
}

function shouldPrioritizeManualRequeue(
	knownPage: OfficialWebPlannerPageCandidate | undefined,
): boolean {
	if (!knownPage) {
		return true;
	}
	return knownPage.worksetReason !== "source_pack_preview_seed";
}

async function loadConfiguredSitemapRequests(input: {
	config: Configuration;
	hostPolicy: OfficialWebHostPolicy;
	requestTimeoutMs: number;
	transform: (request: RequestOptions) => RequestOptions<CollectorRequestUserData> | false;
}): Promise<RequestOptions<CollectorRequestUserData>[]> {
	if (input.hostPolicy.explicitSitemaps.length === 0) {
		return [];
	}
	const requestList = await SitemapRequestList.open({
		sitemapUrls: input.hostPolicy.explicitSitemaps,
		timeoutMillis: input.requestTimeoutMs,
		config: input.config,
	});
	const requests: RequestOptions<CollectorRequestUserData>[] = [];
	try {
		for await (const request of requestList) {
			const transformed = input.transform({
				url: request.url,
				uniqueKey: request.uniqueKey,
				userData: request.userData,
			});
			await requestList.markRequestHandled(request);
			if (transformed) {
				requests.push(transformed);
			}
		}
	} finally {
		await requestList.teardown();
	}
	return requests;
}

function mergeInitialRequests(
	seedRequests: RequestOptions<CollectorRequestUserData>[],
	sitemapRequests: RequestOptions<CollectorRequestUserData>[],
): RequestOptions<CollectorRequestUserData>[] {
	const merged = new Map<string, RequestOptions<CollectorRequestUserData>>();
	for (const request of [...sitemapRequests, ...seedRequests]) {
		const key = request.uniqueKey ?? request.url;
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, request);
			continue;
		}
		const existingKnownPages = existing.userData?.knownPages ?? [];
		const incomingKnownPages = request.userData?.knownPages ?? [];
		if (incomingKnownPages.length > existingKnownPages.length) {
			merged.set(key, request);
		}
	}
	return [...merged.values()];
}
