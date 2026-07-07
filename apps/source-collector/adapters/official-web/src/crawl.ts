import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { OfficialWebArtifactStore } from "./artifact-store.ts";
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
import { runCollectorCrawlMain } from "./crawl-cli.ts";

export type { ResolvedCollectorCrawlMainInput } from "./crawl-cli.ts";
export { resolveCollectorCrawlMainInput } from "./crawl-cli.ts";

import { applyOfficialWebConsumerDenominator } from "./consumer-denominator.ts";
import type {
	OfficialWebControlPlaneClient,
	OfficialWebTerminalStatus,
	OfficialWebTriggerType,
} from "./control-plane.ts";
import {
	buildRunArtifacts,
	buildRunSourceTruthBundle,
	dedupeCollectedPages,
	dedupePageObservations,
	uploadCollectorArtifacts,
	writeCollectorArtifacts,
} from "./crawl-artifacts.ts";
import { type CrawlHostsWithCrawleeInput, crawlHostsWithCrawlee } from "./crawl-host-runner.ts";
import type {
	CollectorAggregatedResults,
	CollectorProgressCounts,
	CollectorSourcePackLineageOverride,
} from "./crawl-internal-types.ts";
import { buildPageObservations } from "./crawl-observations.ts";
import {
	buildTargetWorksetProgressCounts,
	countUniqueRawAssets,
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
import { OFFICIAL_WEB_SOURCE_ADAPTER_VERSION } from "./runtime-metadata.ts";

export interface CrawlSiteOptions {
	repoRoot?: string;
	configRoot?: string;
	crawlRunId?: string;
	schedulerRunKey?: string;
	triggerType?: OfficialWebTriggerType;
	runIntent?: OfficialWebRunIntent;
	traceId?: string;
	sourceAdapterVersion?: string;
	outputDir?: string;
	hostFilter?: string[];
	targetCandidateIds?: string[];
	maxPagesPerHost?: number;
	maxTotalPages?: number;
	artifactStore?: OfficialWebArtifactStore;
	localArtifactsOnly?: boolean;
	controlPlaneClient?: OfficialWebControlPlaneClient;
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
	const bundle = loadOfficialWebConfig(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
	});
	assertCollectorRunAdmission({
		hasControlPlaneAdmission: options.controlPlaneClient != null,
		hasHostFilter: (options.hostFilter?.length ?? 0) > 0,
	});
	const controlPlaneClient = options.controlPlaneClient;
	if (!controlPlaneClient) {
		throw new Error("official-web collector requires ingestion-control target workset admission");
	}
	const executionMode = "target-workset" as const;
	let plan = buildCollectorPlan(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
		crawlRunId: options.crawlRunId,
		runIntent: options.runIntent,
	});
	let selectedHosts = buildSelectedHosts(plan, options.hostFilter);
	const startedAt = new Date().toISOString();
	const sourceAdapterVersion = options.sourceAdapterVersion ?? OFFICIAL_WEB_SOURCE_ADAPTER_VERSION;
	const maxPagesPerHost =
		options.maxPagesPerHost ??
		Math.max(1, ...selectedHosts.map((plannedHost) => plannedHost.maxPagesPerRun));
	const maxTotalPages = options.maxTotalPages ?? plan.runLimits.maxTotalPagesPerRun;
	const sourcePackLineageOverrides = loadSourcePackLineageOverrides(options.sourcePackLineagePath);

	const started = await controlPlaneClient.startRun({
		siteId: plan.siteId,
		schedulerRunKey: options.schedulerRunKey ?? options.crawlRunId ?? plan.crawlRunId,
		runIntent: plan.runIntent,
		triggerType: options.triggerType ?? "manual",
		sourceAdapterVersion,
		configVersion: bundle.site.configVersion,
		crawlPolicyVersion: bundle.site.crawlPolicyVersion,
		hostSet: selectedHosts.map((item) => item.host),
		seedSet: plan.seeds.map((item) => item.url),
		startedAt,
		traceId: options.traceId,
	});
	if (started.run.runId !== plan.crawlRunId) {
		plan = buildCollectorPlan(siteId, {
			repoRoot: options.repoRoot,
			configRoot: options.configRoot,
			crawlRunId: started.run.runId,
			runIntent: options.runIntent,
		});
		selectedHosts = buildSelectedHosts(plan, options.hostFilter);
	}

	const dynamicPlan = await controlPlaneClient.resolvePlan({
		hostFilter: selectedHosts.map((item) => item.host),
		maxPagesPerHost,
		maxTotalPages,
		now: new Date().toISOString(),
		runIntent: plan.runIntent,
		siteId: plan.siteId,
		targetCandidateIds: options.targetCandidateIds ?? [],
		traceId: options.traceId,
	});

	const executionHostFilter = resolveExecutionHostFilter({
		dynamicPlan: dynamicPlan.plan,
	});
	selectedHosts = buildSelectedHosts(plan, executionHostFilter);
	const targetWorksetProgressCounts = buildTargetWorksetProgressCounts(dynamicPlan.plan.duePages);

	const outputDir = options.outputDir ?? defaultCollectorOutputDir(plan.siteId, plan.crawlRunId);
	mkdirSync(outputDir, { recursive: true });

	const config = createOfficialWebCrawlerConfiguration("crawl");

	let heartbeatSequence = 0;
	let latestProgress = emptyProgressCounts();
	let latestPages: CollectedPageArtifact[] = [];
	const reportProgress = async (counts: CollectorProgressCounts): Promise<void> => {
		latestProgress = counts;

		heartbeatSequence += 1;
		await controlPlaneClient.sendHeartbeat({
			runId: plan.crawlRunId,
			sequence: heartbeatSequence,
			observedAt: new Date().toISOString(),
			counts,
			traceId: options.traceId,
		});
	};

	try {
		const aggregatedResults =
			options.crawlHosts == null
				? await crawlHostsWithCrawlee({
						bundle,
						dynamicPlan: dynamicPlan.plan,
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
						bundle,
						dynamicPlan: dynamicPlan.plan,
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
		const dedupedPages = dedupeCollectedPages(aggregatedResults.pages);
		const consumerGate = applyOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			pages: dedupedPages,
		});
		const retainedObservationUrls = new Set(
			consumerGate.retainedPages.map((page) => page.pageManifest.normalizedCanonicalUrl),
		);
		const dedupedPageObservations = dedupePageObservations(
			(aggregatedResults.pageObservations?.length ?? 0) > 0
				? (aggregatedResults.pageObservations ?? []).filter((observation) =>
						observation.disposition === "fetched"
							? retainedObservationUrls.has(observation.normalizedCanonicalUrl)
							: true,
					)
				: buildPageObservations({
						siteId: plan.siteId,
						crawlRunId: plan.crawlRunId,
						runIntent: plan.runIntent,
						pages: consumerGate.retainedPages,
					}),
		);
		const normalizedResults: CollectorAggregatedResults = {
			...aggregatedResults,
			pages: consumerGate.retainedPages,
			pageObservations: dedupedPageObservations,
		};
		latestPages = normalizedResults.pages;
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
				urlsFetched: normalizedResults.urlResults.filter((item) => item.outcome === "fetched")
					.length,
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
		const artifactPaths = writeCollectorArtifacts(outputDir, {
			runArtifacts,
			pages: normalizedResults.pages,
		});
		const uploadResult =
			options.artifactStore == null
				? resolveLocalArtifactOnlyUploadResult(options)
				: await uploadCollectorArtifacts({
						siteId: plan.siteId,
						crawlRunId: plan.crawlRunId,
						artifactStore: options.artifactStore,
						runArtifacts,
						pages: normalizedResults.pages,
					});
		const previousProgress = latestProgress;
		const finalProgress = {
			...summarizeProgressCounts(normalizedResults, uploadResult.artifactUploadCount),
			...targetWorksetProgressCounts,
		};
		latestProgress = finalProgress;

		if (heartbeatSequence === 0 || !sameProgressCounts(previousProgress, finalProgress)) {
			await reportProgress(finalProgress);
		}

		await controlPlaneClient.finalizeRun({
			runId: plan.crawlRunId,
			terminalStatus: crawlStatus,
			finishedAt,
			pageObservations,
			summary: {
				urlsDiscovered: normalizedResults.urlResults.length,
				urlsFetched: normalizedResults.urlResults.filter((item) => item.outcome === "fetched")
					.length,
				pagesNormalized: normalizedResults.pages.length,
				rawAssetsObserved: countUniqueRawAssets(normalizedResults.pages),
				failureCount: normalizedResults.failures.length,
			},
			artifacts: uploadResult.uploadedArtifacts,
			traceId: options.traceId,
		});

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
	} catch (error) {
		try {
			await controlPlaneClient.finalizeRun({
				runId: plan.crawlRunId,
				terminalStatus: "failed",
				finishedAt: new Date().toISOString(),
				pageObservations: [],
				summary: {
					urlsDiscovered: latestProgress.urlsDiscovered,
					urlsFetched: latestProgress.urlsFetched,
					pagesNormalized: latestProgress.pagesNormalized,
					rawAssetsObserved: countUniqueRawAssets(latestPages),
					failureCount: Math.max(latestProgress.failures, 1),
				},
				artifacts: [],
				traceId: options.traceId,
			});
		} catch {
			// Preserve the original crawl failure and avoid masking it with finalize noise.
		}
		throw error;
	}
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

function assertCollectorRunAdmission(input: {
	hasControlPlaneAdmission: boolean;
	hasHostFilter: boolean;
}): void {
	if (input.hasControlPlaneAdmission) {
		return;
	}

	const hostFilterNote = input.hasHostFilter ? " hostFilter cannot create target scope." : "";
	throw new Error(
		`official-web collector requires ingestion-control target workset admission.${hostFilterNote}`,
	);
}

export function crawlMain(argv: string[] = process.argv.slice(2)): Promise<void> {
	return runCollectorCrawlMain(crawlSite, argv);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	await crawlMain();
}
