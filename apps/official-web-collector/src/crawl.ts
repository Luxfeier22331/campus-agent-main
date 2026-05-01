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
	legacyBroadCrawlAdmission?: LegacyBroadCrawlAdmissionInput;
	dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
	crawlHosts?: (input: CrawlHostsWithCrawleeInput) => Promise<CollectorAggregatedResults>;
}

export interface LegacyBroadCrawlAdmission {
	exclusionDecision: "legacy_contract_excluded";
	reason: string;
}

export type LegacyBroadCrawlAdmissionInput =
	| LegacyBroadCrawlAdmission
	| {
			reason: string;
	  };

type OfficialWebCollectorExecutionMode = "target-workset" | "legacy-broad-crawl";

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
	legacyBroadCrawlAdmission?: LegacyBroadCrawlAdmission;
	executionMode: OfficialWebCollectorExecutionMode;
}

export async function crawlSite(
	siteId: string,
	options: CrawlSiteOptions = {},
): Promise<CrawlSiteResult> {
	const bundle = loadOfficialWebConfig(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
	});
	const legacyBroadCrawlAdmission = normalizeLegacyBroadCrawlAdmission(
		options.legacyBroadCrawlAdmission,
	);
	const executionMode: OfficialWebCollectorExecutionMode = options.controlPlaneClient
		? "target-workset"
		: "legacy-broad-crawl";
	assertCollectorRunAdmission({
		hasControlPlaneAdmission: options.controlPlaneClient != null,
		hasHostFilter: (options.hostFilter?.length ?? 0) > 0,
		legacyBroadCrawlAdmission,
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
						targetJobs: 0,
						worksetRows: 0,
					},
				},
			};

	const executionHostFilter = resolveExecutionHostFilter({
		dynamicPlan: dynamicPlan.plan,
		executionMode,
		fallbackHosts: selectedHosts.map((item) => item.host),
	});
	selectedHosts = buildSelectedHosts(plan, executionHostFilter);
	const targetWorksetProgressCounts =
		executionMode === "target-workset"
			? buildTargetWorksetProgressCounts(dynamicPlan.plan.duePages)
			: {};

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
						executionMode,
						hostFilter: executionHostFilter,
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
						executionMode,
						hostFilter: executionHostFilter,
						maxPagesPerHost,
						maxTotalPages,
						dynamicShellDiscoverer: options.dynamicShellDiscoverer,
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
				legacyBroadCrawlAdmission,
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
				? { uploadedArtifacts: [], artifactUploadCount: 0 }
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
			legacyBroadCrawlAdmission,
			executionMode,
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

function normalizeLegacyBroadCrawlAdmission(
	admission: CrawlSiteOptions["legacyBroadCrawlAdmission"],
): LegacyBroadCrawlAdmission | undefined {
	if (admission == null) {
		return;
	}
	const reason = admission.reason.trim();
	if (reason.length === 0) {
		throw new Error("legacy broad crawl admission requires a non-empty reason.");
	}

	return {
		exclusionDecision: "legacy_contract_excluded",
		reason,
	};
}

function resolveExecutionHostFilter(input: {
	dynamicPlan: {
		duePages: Array<{ host?: string; normalizedCanonicalUrl: string }>;
	};
	executionMode: OfficialWebCollectorExecutionMode;
	fallbackHosts: string[];
}): string[] {
	if (input.executionMode !== "target-workset") {
		return input.fallbackHosts;
	}

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

function assertCollectorRunAdmission(input: {
	hasControlPlaneAdmission: boolean;
	hasHostFilter: boolean;
	legacyBroadCrawlAdmission?: LegacyBroadCrawlAdmission;
}): void {
	if (input.hasControlPlaneAdmission && input.legacyBroadCrawlAdmission) {
		throw new Error(
			"legacy broad crawl admission cannot be combined with app-api target workset admission; record legacy exclusion in app-api instead.",
		);
	}
	if (input.hasControlPlaneAdmission || input.legacyBroadCrawlAdmission) {
		return;
	}

	const hostFilterNote = input.hasHostFilter ? " hostFilter cannot create target scope." : "";
	throw new Error(
		`official-web collector requires app-api target workset admission or explicit legacy broad crawl admission.${hostFilterNote}`,
	);
}

export function crawlMain(argv: string[] = process.argv.slice(2)): Promise<void> {
	return runCollectorCrawlMain(crawlSite, argv);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	await crawlMain();
}
