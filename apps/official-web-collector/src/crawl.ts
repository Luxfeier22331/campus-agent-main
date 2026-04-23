import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Configuration } from "crawlee";
import type { OfficialWebArtifactStore } from "./artifact-store.ts";
import { runCollectorCrawlMain } from "./crawl-cli.ts";
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
} from "./official-web-core.ts";

export type { ResolvedCollectorCrawlMainInput } from "./crawl-cli.ts";
export { resolveCollectorCrawlMainInput } from "./crawl-cli.ts";

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
} from "./crawl-internal-types.ts";
import { buildPageObservations } from "./crawl-observations.ts";
import {
	countUniqueRawAssets,
	emptyProgressCounts,
	sameProgressCounts,
	summarizeProgressCounts,
} from "./crawl-progress.ts";
import { buildSelectedHosts, defaultCollectorOutputDir } from "./crawl-support.ts";
import type {
	OfficialWebDynamicShellDiscoverer,
	OfficialWebDynamicShellDiscoveryAudit,
} from "./dynamic-shell-discovery.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";
import { buildCollectorPlan } from "./plan.ts";
import { buildCollectorQualityAudit } from "./quality-audit.ts";
import { OFFICIAL_WEB_COLLECTOR_VERSION } from "./runtime-metadata.ts";

export interface CrawlSiteOptions {
	repoRoot?: string;
	configRoot?: string;
	crawlRunId?: string;
	schedulerRunKey?: string;
	triggerType?: OfficialWebTriggerType;
	runIntent?: OfficialWebRunIntent;
	traceId?: string;
	collectorVersion?: string;
	outputDir?: string;
	hostFilter?: string[];
	maxPagesPerHost?: number;
	maxTotalPages?: number;
	artifactStore?: OfficialWebArtifactStore;
	controlPlaneClient?: OfficialWebControlPlaneClient;
	dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
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
}

export async function crawlSite(
	siteId: string,
	options: CrawlSiteOptions = {},
): Promise<CrawlSiteResult> {
	const bundle = loadOfficialWebConfig(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
	});
	let plan = buildCollectorPlan(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
		crawlRunId: options.crawlRunId,
		runIntent: options.runIntent,
	});
	let selectedHosts = buildSelectedHosts(plan, options.hostFilter);
	const startedAt = new Date().toISOString();
	const collectorVersion = options.collectorVersion ?? OFFICIAL_WEB_COLLECTOR_VERSION;
	const maxPagesPerHost =
		options.maxPagesPerHost ??
		Math.max(1, ...selectedHosts.map((plannedHost) => plannedHost.maxPagesPerRun));
	const maxTotalPages = options.maxTotalPages ?? plan.runLimits.maxTotalPagesPerRun;

	if (options.controlPlaneClient) {
		const started = await options.controlPlaneClient.startRun({
			siteId: plan.siteId,
			schedulerRunKey: options.schedulerRunKey ?? options.crawlRunId ?? plan.crawlRunId,
			runIntent: plan.runIntent,
			triggerType: options.triggerType ?? "manual",
			collectorVersion,
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
	}

	const dynamicPlan = options.controlPlaneClient
		? await options.controlPlaneClient.resolvePlan({
				hostFilter: selectedHosts.map((item) => item.host),
				maxPagesPerHost,
				maxTotalPages,
				now: new Date().toISOString(),
				runIntent: plan.runIntent,
				siteId: plan.siteId,
				traceId: options.traceId,
			})
		: {
				plan: {
					duePages: [],
					hostFilter: selectedHosts.map((item) => item.host),
					maxPagesPerHost,
					maxTotalPages,
					resolvedAt: new Date().toISOString(),
					runIntent: plan.runIntent,
					siteId: plan.siteId,
					summary: {
						duePages: 0,
						listingPages: 0,
						repairPages: 0,
						selectedHosts: 0,
						staticPages: 0,
					},
				},
			};

	const outputDir = options.outputDir ?? defaultCollectorOutputDir(plan.siteId, plan.crawlRunId);
	mkdirSync(outputDir, { recursive: true });

	const config = new Configuration({
		persistStorage: false,
	});

	let heartbeatSequence = 0;
	let latestProgress = emptyProgressCounts();
	let latestPages: CollectedPageArtifact[] = [];
	const reportProgress = async (counts: CollectorProgressCounts): Promise<void> => {
		latestProgress = counts;
		if (!options.controlPlaneClient) {
			return;
		}

		heartbeatSequence += 1;
		await options.controlPlaneClient.sendHeartbeat({
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
						hostFilter: selectedHosts.map((item) => item.host),
						maxPagesPerHost,
						maxTotalPages,
						dynamicShellDiscoverer: options.dynamicShellDiscoverer,
						reportProgress,
					})
				: await options.crawlHosts({
						bundle,
						dynamicPlan: dynamicPlan.plan,
						plan,
						config,
						hostFilter: selectedHosts.map((item) => item.host),
						maxPagesPerHost,
						maxTotalPages,
						dynamicShellDiscoverer: options.dynamicShellDiscoverer,
						reportProgress,
					});
		const dedupedPages = dedupeCollectedPages(aggregatedResults.pages);
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
			pages: dedupedPages,
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
			},
		});
		const sourceTruthBundle = buildRunSourceTruthBundle(
			plan.siteId,
			plan.crawlRunId,
			normalizedResults.pages,
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
				? { uploadedArtifacts: [], artifactUploadCount: 0 }
				: await uploadCollectorArtifacts({
						siteId: plan.siteId,
						crawlRunId: plan.crawlRunId,
						artifactStore: options.artifactStore,
						runArtifacts,
						pages: normalizedResults.pages,
					});
		const previousProgress = latestProgress;
		const finalProgress = summarizeProgressCounts(
			normalizedResults,
			uploadResult.artifactUploadCount,
		);
		latestProgress = finalProgress;

		if (
			options.controlPlaneClient &&
			(heartbeatSequence === 0 || !sameProgressCounts(previousProgress, finalProgress))
		) {
			await reportProgress(finalProgress);
		}

		if (options.controlPlaneClient) {
			await options.controlPlaneClient.finalizeRun({
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
		};
	} catch (error) {
		if (options.controlPlaneClient) {
			try {
				await options.controlPlaneClient.finalizeRun({
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
		}
		throw error;
	}
}

export function crawlMain(argv: string[] = process.argv.slice(2)): Promise<void> {
	return runCollectorCrawlMain(crawlSite, argv);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	await crawlMain();
}
