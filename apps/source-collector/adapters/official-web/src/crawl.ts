import { mkdirSync, readFileSync } from "node:fs";

import type { OfficialWebArtifactStore } from "./artifact-store.ts";
import { applyOfficialWebConsumerDenominator } from "./consumer-denominator.ts";
import {
	buildOfficialWebCrawlRunRecord,
	buildOfficialWebHostSummaryDocument,
	loadOfficialWebConfig,
	type OfficialWebFailureRecord,
	type OfficialWebPageObservationRecord,
	type OfficialWebQualityAuditDocument,
	type OfficialWebRunArtifactRef,
	type OfficialWebRunIntent,
	type OfficialWebSourceTruthBundle,
	type OfficialWebUrlResultRecord,
} from "./core/index.ts";
import {
	buildRunArtifacts,
	buildRunSourceTruthBundle,
	dedupeCollectedPages,
	dedupePageObservations,
	uploadCollectorArtifacts,
	writeCollectorArtifacts,
} from "./crawl-artifacts.ts";
import {
	buildConfiguredSeedCandidates,
	type OfficialWebCrawlCandidate,
} from "./crawl-candidates.ts";
import { type CrawlHostsWithCrawleeInput, crawlHostsWithCrawlee } from "./crawl-host-runner.ts";
import type {
	CollectorAggregatedResults,
	CollectorProgressCounts,
	CollectorSourcePackLineageOverride,
} from "./crawl-internal-types.ts";
import { buildPageObservations } from "./crawl-observations.ts";
import {
	buildTargetWorksetProgressCounts,
	emptyProgressCounts,
	sameProgressCounts,
	summarizeProgressCounts,
} from "./crawl-progress.ts";
import { buildSelectedHosts, defaultCollectorOutputDir } from "./crawl-support.ts";
import { createOfficialWebCrawlerConfiguration } from "./crawlee-runtime.ts";
import type {
	OfficialWebDynamicShellDiscoverer,
	OfficialWebDynamicShellDiscoveryAudit,
} from "./dynamic-shell-discovery.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";
import { buildCollectorPlan } from "./plan.ts";
import { buildCollectorQualityAudit } from "./quality-audit.ts";

type OfficialWebTerminalStatus = "completed" | "completed_with_errors" | "failed";

export interface CrawlSiteOptions {
	abortSignal?: AbortSignal;
	activityAttempt?: number;
	repoRoot?: string;
	configRoot?: string;
	crawlRunId?: string;
	runIntent?: OfficialWebRunIntent;
	outputDir?: string;
	hostFilter?: string[];
	crawlCandidates?: OfficialWebCrawlCandidate[];
	freshnessKnownSeedUrls?: string[];
	maxPagesPerHost?: number;
	maxTotalPages?: number;
	artifactStore?: OfficialWebArtifactStore;
	localArtifactsOnly?: boolean;
	reportProgress?: (counts: CollectorProgressCounts) => Promise<void>;
	sourcePackLineagePath?: string;
	dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
	disableConditionalHeaders?: boolean;
	crawlHosts?: (input: CrawlHostsWithCrawleeInput) => Promise<CollectorAggregatedResults>;
}

export interface CrawlSiteResult {
	outputDir: string;
	artifactPaths: Record<string, string>;
	crawlRun: ReturnType<typeof buildOfficialWebCrawlRunRecord>;
	hostSummary: ReturnType<typeof buildOfficialWebHostSummaryDocument>;
	sourceTruthBundle: OfficialWebSourceTruthBundle;
	qualityAudit: OfficialWebQualityAuditDocument;
	pageObservations: OfficialWebPageObservationRecord[];
	urlResults: OfficialWebUrlResultRecord[];
	failures: OfficialWebFailureRecord[];
	pages: CollectedPageArtifact[];
	dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[];
	uploadedArtifacts: OfficialWebRunArtifactRef[];
	executionMode: "target-workset";
}

export async function crawlSite(
	siteId: string,
	options: CrawlSiteOptions = {},
): Promise<CrawlSiteResult> {
	options.abortSignal?.throwIfAborted();
	const bundle = loadOfficialWebConfig(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
	});
	const executionMode = "target-workset" as const;
	const plan = buildCollectorPlan(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
		crawlRunId: options.crawlRunId,
		runIntent: options.runIntent,
	});
	let selectedHosts = buildSelectedHosts(plan, options.hostFilter);
	if (options.artifactStore == null && options.localArtifactsOnly !== true) {
		throw new Error(
			"official-web collector requires artifactStore unless localArtifactsOnly is true",
		);
	}
	const startedAt = new Date().toISOString();
	const maxPagesPerHost =
		options.maxPagesPerHost ??
		Math.max(1, ...selectedHosts.map((plannedHost) => plannedHost.maxPagesPerRun));
	const maxTotalPages = options.maxTotalPages ?? plan.runLimits.maxTotalPagesPerRun;
	const sourcePackLineageOverrides = loadSourcePackLineageOverrides(options.sourcePackLineagePath);

	const duePages = resolveCrawlCandidates(plan, options);
	const dynamicPlan = {
		duePages,
		resolvedAt: startedAt,
		summary: {
			duePages: duePages.length,
			listingPages: 0,
			repairPages: 0,
			selectedHosts: new Set(duePages.map((page) => page.host)).size,
			staticPages: duePages.length,
			targetJobs: new Set(duePages.map((page) => page.targetJobId)).size,
			worksetRows: duePages.length,
		},
	};

	const executionHostFilter = resolveExecutionHostFilter({
		dynamicPlan,
	});
	selectedHosts = buildSelectedHosts(plan, executionHostFilter);
	const targetWorksetProgressCounts = buildTargetWorksetProgressCounts(dynamicPlan.duePages);

	const outputDir = options.outputDir ?? defaultCollectorOutputDir(plan.siteId, plan.crawlRunId);
	if (options.localArtifactsOnly === true) {
		mkdirSync(outputDir, { recursive: true });
	}

	const config = createOfficialWebCrawlerConfiguration("crawl");

	let latestProgress = emptyProgressCounts();
	const reportProgress = async (counts: CollectorProgressCounts): Promise<void> => {
		options.abortSignal?.throwIfAborted();
		latestProgress = counts;
		await options.reportProgress?.(counts);
		options.abortSignal?.throwIfAborted();
	};
	const aggregatedResults =
		options.crawlHosts == null
			? await crawlHostsWithCrawlee({
					abortSignal: options.abortSignal,
					bundle,
					dynamicPlan,
					plan,
					config,
					hostFilter: executionHostFilter,
					maxPagesPerHost,
					maxTotalPages,
					dynamicShellDiscoverer: options.dynamicShellDiscoverer,
					disableConditionalHeaders: options.disableConditionalHeaders,
					sourcePackLineageOverrides,
					reportProgress,
				})
			: await options.crawlHosts({
					abortSignal: options.abortSignal,
					bundle,
					dynamicPlan,
					plan,
					config,
					hostFilter: executionHostFilter,
					maxPagesPerHost,
					maxTotalPages,
					dynamicShellDiscoverer: options.dynamicShellDiscoverer,
					disableConditionalHeaders: options.disableConditionalHeaders,
					sourcePackLineageOverrides,
					reportProgress,
				});
	options.abortSignal?.throwIfAborted();
	const dedupedPages = dedupeCollectedPages(aggregatedResults.pages);
	const consumerGate = applyOfficialWebConsumerDenominator({
		consumerDenominator: bundle.consumerDenominator,
		pages: dedupedPages,
	});
	const dedupedPageObservations = dedupePageObservations(
		(aggregatedResults.pageObservations?.length ?? 0) > 0
			? (aggregatedResults.pageObservations ?? [])
			: buildPageObservations({
					siteId: plan.siteId,
					crawlRunId: plan.crawlRunId,
					runIntent: plan.runIntent,
					pages: dedupedPages,
				}),
	);
	const normalizedResults: CollectorAggregatedResults = {
		...aggregatedResults,
		pages: consumerGate.retainedPages,
		pageObservations: dedupedPageObservations,
	};
	const finishedAt = new Date().toISOString();

	const crawlStatus: OfficialWebTerminalStatus =
		normalizedResults.failures.length > 0 ? "completed_with_errors" : "completed";
	const hostSummary = buildOfficialWebHostSummaryDocument({
		siteId: plan.siteId,
		crawlRunId: plan.crawlRunId,
		generatedAt: finishedAt,
		hosts: normalizedResults.hostSummaries,
	});
	const crawlRun = buildOfficialWebCrawlRunRecord({
		siteId: plan.siteId,
		crawlRunId: plan.crawlRunId,
		runIntent: plan.runIntent,
		startedAt,
		finishedAt,
		status: crawlStatus,
		counters: {
			urlsObserved: normalizedResults.urlResults.length,
			urlsFetched: normalizedResults.urlResults.filter((item) => item.outcome === "fetched").length,
			failures: normalizedResults.failures.length,
			hostsPlanned: selectedHosts.length,
			hostsCompleted: normalizedResults.hostSummaries.length,
			consumerDenominator: consumerGate.summary,
		},
	});
	const sourceTruthBundle = buildRunSourceTruthBundle(
		plan.siteId,
		plan.crawlRunId,
		normalizedResults.pages,
		{
			collectionMode: executionMode,
		},
	);
	const qualityAudit = buildCollectorQualityAudit({
		siteId: plan.siteId,
		crawlRunId: plan.crawlRunId,
		pages: normalizedResults.pages,
	});
	const pageObservations = normalizedResults.pageObservations ?? [];
	const runArtifacts = buildRunArtifacts({
		crawlRun,
		hostSummary,
		sourceTruthBundle,
		qualityAudit,
		pageObservations,
		urlResults: normalizedResults.urlResults,
		failures: normalizedResults.failures,
		dynamicShellDiscoveryAudits: normalizedResults.dynamicShellDiscoveryAudits ?? [],
	});
	options.abortSignal?.throwIfAborted();
	const artifactPaths =
		options.localArtifactsOnly === true
			? writeCollectorArtifacts(outputDir, {
					runArtifacts,
					pages: normalizedResults.pages,
				})
			: {};
	const uploadResult =
		options.artifactStore == null
			? resolveLocalArtifactOnlyUploadResult(options)
			: await uploadCollectorArtifacts({
					abortSignal: options.abortSignal,
					activityAttempt: options.activityAttempt ?? 1,
					siteId: plan.siteId,
					crawlRunId: plan.crawlRunId,
					artifactStore: options.artifactStore,
					runArtifacts,
					pages: normalizedResults.pages,
				});
	options.abortSignal?.throwIfAborted();
	const previousProgress = latestProgress;
	const finalProgress = {
		...summarizeProgressCounts(normalizedResults, uploadResult.artifactUploadCount),
		...targetWorksetProgressCounts,
	};
	latestProgress = finalProgress;

	if (!sameProgressCounts(previousProgress, finalProgress)) {
		await reportProgress(finalProgress);
	}

	return {
		outputDir,
		artifactPaths,
		crawlRun,
		hostSummary,
		sourceTruthBundle,
		qualityAudit,
		pageObservations,
		urlResults: normalizedResults.urlResults,
		failures: normalizedResults.failures,
		pages: normalizedResults.pages,
		dynamicShellDiscoveryAudits: normalizedResults.dynamicShellDiscoveryAudits ?? [],
		uploadedArtifacts: uploadResult.uploadedArtifacts,
		executionMode,
	};
}

function loadSourcePackLineageOverrides(
	path: string | undefined,
): Record<string, CollectorSourcePackLineageOverride> | undefined {
	if (!path) {
		return;
	}
	const payload = JSON.parse(readFileSync(path, "utf-8"));
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("source-pack lineage override payload must be an object");
	}
	return payload as Record<string, CollectorSourcePackLineageOverride>;
}

function resolveExecutionHostFilter(input: {
	dynamicPlan: {
		duePages: Array<{ host?: string; normalizedCanonicalUrl: string }>;
	};
}): string[] {
	return [
		...new Set(
			input.dynamicPlan.duePages
				.map((page) => {
					const host = page.host || new URL(page.normalizedCanonicalUrl).hostname;
					return host.trim().toLowerCase();
				})
				.filter(Boolean),
		),
	].sort();
}

function resolveCrawlCandidates(
	plan: ReturnType<typeof buildCollectorPlan>,
	options: Pick<CrawlSiteOptions, "crawlCandidates" | "freshnessKnownSeedUrls" | "hostFilter">,
): OfficialWebCrawlCandidate[] {
	const enabledHosts = new Set(plan.enabledHosts.map((host) => host.host.trim().toLowerCase()));
	const hostFilter = new Set(
		(options.hostFilter ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean),
	);
	const inRequestedHosts = (candidate: OfficialWebCrawlCandidate) => {
		if (candidate.siteId !== plan.siteId) {
			throw new Error(`crawl candidate siteId ${candidate.siteId} does not match ${plan.siteId}`);
		}
		const host = candidate.host.trim().toLowerCase();
		return enabledHosts.has(host) && (hostFilter.size === 0 || hostFilter.has(host));
	};
	const configuredSeeds = buildConfiguredSeedCandidates(plan).filter(inRequestedHosts);
	if (options.crawlCandidates === undefined) {
		return configuredSeeds;
	}

	const candidates = options.crawlCandidates.filter(inRequestedHosts);
	if (options.freshnessKnownSeedUrls === undefined) {
		return candidates;
	}
	const knownSeedUrls = new Set(
		options.freshnessKnownSeedUrls.map((url) => url.trim()).filter(Boolean),
	);
	const merged = new Map<string, OfficialWebCrawlCandidate>();
	for (const seed of configuredSeeds) {
		if (!knownSeedUrls.has(seed.normalizedCanonicalUrl)) {
			merged.set(seed.normalizedCanonicalUrl, seed);
		}
	}
	for (const candidate of candidates) {
		const configuredSeedUrl = merged.get(candidate.normalizedCanonicalUrl)?.configuredSeedUrl;
		merged.set(
			candidate.normalizedCanonicalUrl,
			configuredSeedUrl ? { ...candidate, configuredSeedUrl } : candidate,
		);
	}
	return [...merged.values()];
}

function resolveLocalArtifactOnlyUploadResult(options: CrawlSiteOptions): {
	uploadedArtifacts: OfficialWebRunArtifactRef[];
	artifactUploadCount: number;
} {
	if (options.localArtifactsOnly === true) {
		return { uploadedArtifacts: [], artifactUploadCount: 0 };
	}
	throw new Error(
		"official-web collector requires artifactStore unless localArtifactsOnly is true",
	);
}
