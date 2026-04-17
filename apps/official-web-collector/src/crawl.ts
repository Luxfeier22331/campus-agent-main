import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  CheerioCrawler,
  Configuration,
  RequestQueue,
  RobotsTxtFile,
  Sitemap,
  type CheerioCrawlingContext,
} from "crawlee";
import {
  OFFICIAL_WEB_DYNAMIC_SHELL_DISCOVERY_AUDIT_ARTIFACT,
  OFFICIAL_WEB_PAGE_OBSERVATIONS_ARTIFACT,
  OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
  OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
  admitOfficialWebUrl,
  buildOfficialWebCrawlRunRecord,
  buildOfficialWebFailureRecord,
  buildOfficialWebHostSummaryDocument,
  buildOfficialWebPageObservationRecord,
  buildOfficialWebRunArtifactKey,
  buildOfficialWebSourceTruthBundle,
  buildOfficialWebUrlIdentity,
  buildOfficialWebUrlResultRecord,
  defaultRepoRoot,
  findOfficialWebHostPolicy,
  loadOfficialWebConfig,
  resolveOfficialWebRunArtifactType,
  type OfficialWebConfigBundle,
  type OfficialWebCrawlPlan,
  type OfficialWebFailureRecord,
  type OfficialWebHostPolicy,
  type OfficialWebHostSummaryRecord,
  type OfficialWebKnownRunArtifactName,
  type OfficialWebPageObservationRecord,
  type OfficialWebRunArtifactRef,
  type OfficialWebRunIntent,
  type OfficialWebQualityAuditDocument,
  type OfficialWebSourceTruthBundle,
  type OfficialWebUrlResultOutcome,
  type OfficialWebUrlResultRecord,
} from "./official-web-core.ts";

import type { OfficialWebArtifactStore } from "./artifact-store.ts";
import { createS3ArtifactStoreFromEnv } from "./artifact-store.ts";
import { normalizeCliArgs } from "./cli.ts";
import { createOfficialWebControlPlaneClient } from "./control-plane.ts";
import type {
  OfficialWebControlPlaneClient,
  OfficialWebPlannerPageCandidate,
  OfficialWebTerminalStatus,
  OfficialWebTriggerType,
} from "./control-plane.ts";
import {
  discoverDynamicShellPromotedUrls,
  type OfficialWebDynamicShellDiscoveryAudit,
  type OfficialWebDynamicShellDiscoverer,
  type OfficialWebDynamicShellDiscovererOutput,
  type OfficialWebDynamicShellDiscoveryResult,
} from "./dynamic-shell-discovery.ts";
import { buildCollectedPageArtifacts, type CollectedPageArtifact } from "./page-artifacts.ts";
import { buildCollectorPlan } from "./plan.ts";
import { buildCollectorQualityAudit } from "./quality-audit.ts";
import { OFFICIAL_WEB_COLLECTOR_VERSION } from "./runtime-metadata.ts";

interface CollectorRequestUserData {
  discoveryMethod: "seed" | "robots_sitemap" | "configured_sitemap" | "navigation" | "manual_requeue";
  conditionalHeaders?: {
    ifModifiedSince?: string;
    ifNoneMatch?: string;
  };
  discoveredFromUrl: string | null;
  depth: number;
  knownPage?: OfficialWebPlannerPageCandidate;
}

interface CollectorAggregatedResults {
  hostSummaries: OfficialWebHostSummaryRecord[];
  pageObservations?: OfficialWebPageObservationRecord[];
  urlResults: OfficialWebUrlResultRecord[];
  failures: OfficialWebFailureRecord[];
  pages: CollectedPageArtifact[];
  dynamicShellDiscoveryAudits?: OfficialWebDynamicShellDiscoveryAudit[];
}

interface CollectorProgressCounts {
  urlsDiscovered: number;
  urlsFetched: number;
  pagesNormalized: number;
  artifactUploads: number;
  failures: number;
}

interface CollectorRobotsState {
  robots: RobotsTxtFile | null;
  sitemaps: string[];
  blocked: boolean;
  failure: OfficialWebFailureRecord | null;
}

interface CollectorHostCrawlResult extends CollectorAggregatedResults {
  completed: boolean;
}

interface RunArtifactDescriptor {
  artifactName: OfficialWebKnownRunArtifactName;
  contentType: string;
  data: Uint8Array;
  recordCount?: number;
}

interface CollectorCliEnvironment {
  OFFICIAL_WEB_APP_API_BASE_URL?: string;
  OFFICIAL_WEB_SERVICE_TOKEN?: string;
  OFFICIAL_WEB_RUN_INTENT?: string;
  OFFICIAL_WEB_TRACE_ID?: string;
  OFFICIAL_WEB_TRIGGER_TYPE?: string;
  OBJECT_STORE_ACCESS_KEY?: string;
  OBJECT_STORE_BUCKET_SOURCE?: string;
  OBJECT_STORE_ENDPOINT?: string;
  OBJECT_STORE_REGION?: string;
  OBJECT_STORE_SECRET_KEY?: string;
}

export interface ResolvedCollectorCrawlMainInput {
  options: CrawlSiteOptions;
  siteId: string;
}

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
  crawlHosts?: (input: {
    bundle: OfficialWebConfigBundle;
    dynamicPlan: {
      duePages: OfficialWebPlannerPageCandidate[];
      resolvedAt: string;
      summary: {
        duePages: number;
        listingPages: number;
        repairPages: number;
        selectedHosts: number;
        staticPages: number;
      };
    };
    plan: OfficialWebCrawlPlan;
    config: Configuration;
    maxPagesPerHost: number;
    maxTotalPages: number;
    reportProgress?: (counts: CollectorProgressCounts) => Promise<void>;
  }) => Promise<CollectorAggregatedResults>;
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
      options.crawlHosts != null
        ? await options.crawlHosts({
            bundle,
            dynamicPlan: dynamicPlan.plan,
            plan,
            config,
            maxPagesPerHost,
            maxTotalPages,
            reportProgress,
          })
        : await crawlHostsWithCrawlee({
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
        urlsFetched: normalizedResults.urlResults.filter((item) => item.outcome === "fetched").length,
        failures: normalizedResults.failures.length,
        hostsPlanned: selectedHosts.length,
        hostsCompleted: normalizedResults.hostSummaries.length,
      },
    });
    const sourceTruthBundle = buildRunSourceTruthBundle(plan.siteId, plan.crawlRunId, normalizedResults.pages);
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
      options.artifactStore != null
        ? await uploadCollectorArtifacts({
            siteId: plan.siteId,
            crawlRunId: plan.crawlRunId,
            artifactStore: options.artifactStore,
            runArtifacts,
            pages: normalizedResults.pages,
          })
        : { uploadedArtifacts: [], artifactUploadCount: 0 };
    const previousProgress = latestProgress;
    const finalProgress = summarizeProgressCounts(
      normalizedResults,
      uploadResult.artifactUploadCount,
    );
    latestProgress = finalProgress;

    if (options.controlPlaneClient && (heartbeatSequence === 0 || !sameProgressCounts(previousProgress, finalProgress))) {
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
          urlsFetched: normalizedResults.urlResults.filter((item) => item.outcome === "fetched").length,
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
  const resolved = resolveCollectorCrawlMainInput(argv);

  return crawlSite(resolved.siteId, resolved.options).then((result) => {
    console.log(
      JSON.stringify(
        {
          outputDir: result.outputDir,
          artifactPaths: result.artifactPaths,
          crawlRun: result.crawlRun,
          uploadedArtifacts: result.uploadedArtifacts,
        },
        null,
        2,
      ),
    );
  });
}

export function resolveCollectorCrawlMainInput(
  argv: string[] = process.argv.slice(2),
  env: CollectorCliEnvironment = process.env,
): ResolvedCollectorCrawlMainInput {
  const { values } = parseArgs({
    args: normalizeCliArgs(argv),
    options: {
      "app-api-base-url": { type: "string" },
      "site-id": { type: "string" },
      "repo-root": { type: "string" },
      "config-root": { type: "string" },
      "crawl-run-id": { type: "string" },
      "run-intent": { type: "string" },
      "scheduler-run-key": { type: "string" },
      "service-token": { type: "string" },
      "output-dir": { type: "string" },
      "trace-id": { type: "string" },
      "trigger-type": { type: "string" },
      host: { type: "string", multiple: true },
      "max-pages-per-host": { type: "string" },
      "max-total-pages": { type: "string" },
    },
    allowPositionals: false,
  });

  const siteId = values["site-id"];
  if (typeof siteId !== "string" || siteId.length === 0) {
    throw new Error("--site-id is required");
  }

  const appApiBaseUrl = firstNonEmptyString(
    values["app-api-base-url"],
    env.OFFICIAL_WEB_APP_API_BASE_URL,
  );
  const serviceToken = firstNonEmptyString(values["service-token"], env.OFFICIAL_WEB_SERVICE_TOKEN);
  const runIntent = parseRunIntent(
    firstNonEmptyString(values["run-intent"], env.OFFICIAL_WEB_RUN_INTENT),
  );
  const triggerType = parseTriggerType(
    firstNonEmptyString(values["trigger-type"], env.OFFICIAL_WEB_TRIGGER_TYPE),
  );
  const traceId = firstNonEmptyString(values["trace-id"], env.OFFICIAL_WEB_TRACE_ID);
  const controlPlaneClient =
    appApiBaseUrl || serviceToken
      ? buildConfiguredControlPlaneClient({
          appApiBaseUrl,
          serviceToken,
        })
      : undefined;

  return {
    options: {
      repoRoot: values["repo-root"],
      configRoot: values["config-root"],
      crawlRunId: values["crawl-run-id"],
      runIntent,
      schedulerRunKey: values["scheduler-run-key"],
      triggerType,
      traceId,
      outputDir: values["output-dir"],
      hostFilter: values.host,
      maxPagesPerHost: parseOptionalInt(values["max-pages-per-host"]),
      maxTotalPages: parseOptionalInt(values["max-total-pages"]),
      artifactStore: createS3ArtifactStoreFromEnv(env),
      controlPlaneClient,
    },
    siteId,
  };
}

async function crawlHostsWithCrawlee(input: {
  bundle: OfficialWebConfigBundle;
  dynamicPlan: {
    duePages: OfficialWebPlannerPageCandidate[];
    resolvedAt: string;
    summary: {
      duePages: number;
      listingPages: number;
      repairPages: number;
      selectedHosts: number;
      staticPages: number;
    };
  };
  plan: OfficialWebCrawlPlan;
  config: Configuration;
  hostFilter?: string[];
  maxPagesPerHost: number;
  maxTotalPages: number;
  dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
  reportProgress?: (counts: CollectorProgressCounts) => Promise<void>;
}): Promise<CollectorAggregatedResults> {
  const hostFilter = new Set((input.hostFilter ?? []).map((item) => item.toLowerCase()));
  const selectedHosts = input.plan.enabledHosts.filter(
    (item) => hostFilter.size === 0 || hostFilter.has(item.host.toLowerCase()),
  );

  const hostSummaries: OfficialWebHostSummaryRecord[] = [];
  const pageObservations: OfficialWebPageObservationRecord[] = [];
  const urlResults: OfficialWebUrlResultRecord[] = [];
  const failures: OfficialWebFailureRecord[] = [];
  const pages: CollectedPageArtifact[] = [];
  const dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[] = [];
  let remainingTotalPages = input.maxTotalPages;

  for (const plannedHost of selectedHosts) {
    if (remainingTotalPages <= 0 || failures.length >= input.plan.runLimits.maxTotalFailuresPerRun) {
      break;
    }

    const hostPolicy = findOfficialWebHostPolicy(input.bundle, plannedHost.host);
    if (!hostPolicy) {
      failures.push(
        buildOfficialWebFailureRecord({
          siteId: input.plan.siteId,
          crawlRunId: input.plan.crawlRunId,
          host: plannedHost.host,
          url: `https://${plannedHost.host}/`,
          phase: "queue",
          reason: "host_policy_missing",
          message: `missing host policy for ${plannedHost.host}`,
          retryable: false,
        }),
      );
      if (input.reportProgress) {
        await input.reportProgress(
          summarizeProgressCounts({ hostSummaries, pageObservations, urlResults, failures, pages }, 0),
        );
      }
      continue;
    }

    const hostResult = await crawlSingleHost({
      bundle: input.bundle,
      plan: input.plan,
      hostPolicy,
      config: input.config,
      plannerPages: input.dynamicPlan.duePages.filter((page) => page.host === plannedHost.host),
      maxPagesForHost: Math.min(
        input.maxPagesPerHost,
        plannedHost.maxPagesPerRun,
        remainingTotalPages,
      ),
      dynamicShellDiscoverer: input.dynamicShellDiscoverer,
    });
    hostSummaries.push(...hostResult.hostSummaries);
    pageObservations.push(...(hostResult.pageObservations ?? []));
    urlResults.push(...hostResult.urlResults);
    failures.push(...hostResult.failures);
    pages.push(...hostResult.pages);
    dynamicShellDiscoveryAudits.push(...(hostResult.dynamicShellDiscoveryAudits ?? []));
    remainingTotalPages -= hostResult.urlResults.length;

    if (input.reportProgress) {
      await input.reportProgress(
        summarizeProgressCounts({ hostSummaries, pageObservations, urlResults, failures, pages }, 0),
      );
    }
  }

  return {
    hostSummaries,
    pageObservations,
    urlResults,
    failures,
    pages,
    dynamicShellDiscoveryAudits,
  };
}

async function crawlSingleHost(input: {
  bundle: OfficialWebConfigBundle;
  plan: OfficialWebCrawlPlan;
  hostPolicy: OfficialWebHostPolicy;
  config: Configuration;
  plannerPages: OfficialWebPlannerPageCandidate[];
  maxPagesForHost: number;
  dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
}): Promise<CollectorHostCrawlResult> {
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

  const robotsState = await loadRobotsState(input.bundle, input.plan, input.hostPolicy);
  if (robotsState.failure != null) {
    failures.push(robotsState.failure);
    hostSummary.failures += 1;
  }
  if (robotsState.blocked) {
    hostSummary.robotsBlocked = true;
    return {
      hostSummaries: [hostSummary],
      pageObservations,
      urlResults,
      failures,
      pages,
      dynamicShellDiscoveryAudits,
      completed: false,
    };
  }

  const seedRequests = await buildInitialRequests({
    bundle: input.bundle,
    plan: input.plan,
    hostPolicy: input.hostPolicy,
    plannerPages: input.plannerPages,
    robotsState,
    hostSummary,
    urlResults,
  });
  if (seedRequests.length === 0) {
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
  const crawler = new CheerioCrawler(
    {
      requestQueue,
      maxConcurrency: input.hostPolicy.maxConcurrency,
      maxRequestsPerCrawl: input.maxPagesForHost,
      sameDomainDelaySecs: input.hostPolicy.minDelayMs / 1000,
      requestHandlerTimeoutSecs: input.bundle.site.requestHandlerTimeoutMs / 1000,
      navigationTimeoutSecs: input.bundle.site.requestTimeoutMs / 1000,
      maxRequestRetries: input.bundle.site.maxRequestRetries,
      additionalHttpErrorStatusCodes: [429],
      additionalMimeTypes: ["application/octet-stream"],
      ignoreSslErrors: false,
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
        const knownPage = userData.knownPage;
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
              responseHeaders: context.response.headers as Record<string, string | string[] | undefined>,
              httpStatus: httpStatus ?? 200,
              contentType: contentType ?? "text/html",
              discoveryMethod: userData.discoveryMethod,
              discoveredFromUrl: userData.discoveredFromUrl,
              fetchedAt: new Date().toISOString(),
              html: context.$,
            });
            pages.push(pageArtifact);
            pageObservations.push(
              buildPageObservationFromCollectedPage(input.plan.siteId, input.plan.crawlRunId, input.plan.runIntent, pageArtifact),
            );

            const promotedRequests = buildListingRequeueRequests({
              bundle: input.bundle,
              hostPolicy: input.hostPolicy,
              hostSummary,
              knownPage,
              plannerPageLookup,
              page: pageArtifact,
              robotsState,
              depth: Math.min(userData.depth + 1, input.hostPolicy.maxDepth),
            });
            const dynamicShellRequests = await buildDynamicShellRequeueRequests({
              bundle: input.bundle,
              failures,
              hostPolicy: input.hostPolicy,
              hostSummary,
              plan: input.plan,
              plannerPageLookup,
              page: pageArtifact,
              robotsState,
              depth: Math.min(userData.depth + 1, input.hostPolicy.maxDepth),
              dynamicShellDiscoverer: input.dynamicShellDiscoverer ?? discoverDynamicShellPromotedUrls,
            });
            dynamicShellDiscoveryAudits.push(...dynamicShellRequests.audits);
            const requeueRequests = [...promotedRequests, ...dynamicShellRequests.requests];
            if (requeueRequests.length > 0) {
              await context.crawler.addRequests(requeueRequests, { forefront: true });
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

        const nextRequests = collectNavigationRequests({
          bundle: input.bundle,
          hostPolicy: input.hostPolicy,
          robotsState,
          plannerPageLookup,
          html: context.$,
          baseUrl: finalUrl,
          depth: userData.depth + 1,
          hostSummary,
        });
        if (nextRequests.length > 0) {
          await context.crawler.addRequests(nextRequests);
        }
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

  await crawler.run(seedRequests);

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

async function loadRobotsState(
  bundle: OfficialWebConfigBundle,
  plan: OfficialWebCrawlPlan,
  hostPolicy: OfficialWebHostPolicy,
): Promise<CollectorRobotsState> {
  const robotsUrl = `https://${hostPolicy.host}/robots.txt`;
  const maxAttempts = Math.max(1, bundle.site.maxRequestRetries + 1);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(robotsUrl, {
        headers: {
          "user-agent": bundle.site.userAgent,
        },
        redirect: "follow",
      });
      if (response.status === 429) {
        return {
          robots: null,
          sitemaps: [],
          blocked: true,
          failure: buildOfficialWebFailureRecord({
            siteId: plan.siteId,
            crawlRunId: plan.crawlRunId,
            host: hostPolicy.host,
            url: robotsUrl,
            phase: "robots",
            reason: "robots_rate_limited",
            message: `robots.txt returned ${response.status}`,
            retryable: true,
          }),
        };
      }
      if (response.status >= 500) {
        return {
          robots: null,
          sitemaps: [],
          blocked: true,
          failure: buildOfficialWebFailureRecord({
            siteId: plan.siteId,
            crawlRunId: plan.crawlRunId,
            host: hostPolicy.host,
            url: robotsUrl,
            phase: "robots",
            reason: "robots_server_error",
            message: `robots.txt returned ${response.status}`,
            retryable: true,
          }),
        };
      }
      if (response.status >= 400) {
        return {
          robots: null,
          sitemaps: [...hostPolicy.explicitSitemaps],
          blocked: false,
          failure: null,
        };
      }

      const robotsContent = await response.text();
      const robots = RobotsTxtFile.from(robotsUrl, robotsContent);
      return {
        robots,
        sitemaps: uniqueStrings([...robots.getSitemaps(), ...hostPolicy.explicitSitemaps]),
        blocked: false,
        failure: null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        continue;
      }
    }
  }

  return {
    robots: null,
    sitemaps: [],
    blocked: true,
    failure: buildOfficialWebFailureRecord({
      siteId: plan.siteId,
      crawlRunId: plan.crawlRunId,
      host: hostPolicy.host,
      url: robotsUrl,
      phase: "robots",
      reason: "robots_fetch_failed",
      message: formatErrorWithCauses(lastError),
      retryable: true,
    }),
  };
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

async function buildInitialRequests(input: {
  bundle: OfficialWebConfigBundle;
  plan: OfficialWebCrawlPlan;
  hostPolicy: OfficialWebHostPolicy;
  plannerPages: OfficialWebPlannerPageCandidate[];
  robotsState: CollectorRobotsState;
  hostSummary: OfficialWebHostSummaryRecord;
  urlResults: OfficialWebUrlResultRecord[];
}): Promise<Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }>> {
  const candidates: Array<{
    url: string;
    discoveryMethod: CollectorRequestUserData["discoveryMethod"];
    discoveredFromUrl?: string | null;
    knownPage?: OfficialWebPlannerPageCandidate;
  }> = input.hostPolicy.seedUrls.map((url) => ({
    url,
    discoveryMethod: "seed",
  }));

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
  for (const page of input.plannerPages) {
    candidates.push({
      url: page.normalizedCanonicalUrl,
      discoveryMethod: page.discoveryMethod,
      discoveredFromUrl: page.discoveredFromUrl,
      knownPage: page,
    });
  }

  const requests = new Map<string, { url: string; uniqueKey: string; userData: CollectorRequestUserData }>();
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
      !input.robotsState.robots.isAllowed(admission.normalizedUrl, buildRobotsUserAgent(input.bundle))
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

    requests.set(admission.normalizedUrl, {
      url: admission.normalizedUrl,
      uniqueKey: admission.normalizedUrl,
      userData: {
        discoveryMethod: candidate.discoveryMethod,
        conditionalHeaders: buildConditionalHeaders(candidate.knownPage),
        discoveredFromUrl: candidate.discoveredFromUrl ?? null,
        depth: 0,
        ...(candidate.knownPage ? { knownPage: candidate.knownPage } : {}),
      },
    });
  }

  return [...requests.values()];
}

function collectNavigationRequests(input: {
  bundle: OfficialWebConfigBundle;
  hostPolicy: OfficialWebHostPolicy;
  robotsState: CollectorRobotsState;
  plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
  html: CheerioCrawlingContext["$"];
  baseUrl: string;
  depth: number;
  hostSummary: OfficialWebHostSummaryRecord;
}): Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }> {
  const requests = new Map<string, { url: string; uniqueKey: string; userData: CollectorRequestUserData }>();
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
    if (
      input.robotsState.robots != null &&
      !input.robotsState.robots.isAllowed(admission.normalizedUrl, buildRobotsUserAgent(input.bundle))
    ) {
      input.hostSummary.admissionRejected += 1;
      continue;
    }

    requests.set(admission.normalizedUrl, {
      url: admission.normalizedUrl,
      uniqueKey: admission.normalizedUrl,
      userData: {
        discoveryMethod: "navigation",
        conditionalHeaders: buildConditionalHeaders(input.plannerPageLookup.get(admission.normalizedUrl)),
        discoveredFromUrl: input.baseUrl,
        depth: input.depth,
        knownPage: input.plannerPageLookup.get(admission.normalizedUrl),
      },
    });
  }

  return [...requests.values()];
}

function buildConditionalHeaders(page: OfficialWebPlannerPageCandidate | undefined): {
  ifModifiedSince?: string;
  ifNoneMatch?: string;
} | undefined {
  if (!page) {
    return undefined;
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

function buildPageObservationFromCollectedPage(
  siteId: string,
  crawlRunId: string,
  runIntent: OfficialWebRunIntent,
  page: CollectedPageArtifact,
): OfficialWebPageObservationRecord {
  return buildOfficialWebPageObservationRecord({
    siteId,
    crawlRunId,
    runIntent,
    rawAssetId: page.rawAssetId,
    rawVersionId: page.rawVersionId,
    host: page.pageManifest.host,
    requestedUrl: page.pageManifest.requestedUrl,
    finalUrl: page.pageManifest.finalUrl,
    normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
    pageFamily: page.pageManifest.pageFamily,
    pageTitleNormalized: page.pageManifest.pageTitleNormalized,
    discoveryMethod: page.pageManifest.discoveryMethod,
    discoveredFromUrl: page.pageManifest.discoveredFromUrl,
    httpStatus: page.pageManifest.httpStatus,
    contentType: page.pageManifest.contentType,
    etag: page.pageManifest.etag,
    lastModified: page.pageManifest.lastModified,
    responseBodyHash: page.pageManifest.responseBodyHash,
    mainContentHash: page.pageManifest.mainContentHash,
    disposition: "fetched",
    observedAt: page.pageManifest.fetchedAt,
  });
}

function buildKnownPageObservation(input: {
  crawlRunId: string;
  disposition: "deleted" | "fetch_failed" | "not_modified";
  finalUrl: string;
  httpStatus: number | null;
  knownPage: OfficialWebPlannerPageCandidate;
  observedAt: string;
  requestedUrl: string;
  runIntent: OfficialWebRunIntent;
}): OfficialWebPageObservationRecord {
  return buildOfficialWebPageObservationRecord({
    siteId: input.knownPage.siteId,
    crawlRunId: input.crawlRunId,
    runIntent: input.runIntent,
    rawAssetId: null,
    rawVersionId: null,
    host: input.knownPage.host,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    normalizedCanonicalUrl: input.knownPage.normalizedCanonicalUrl,
    pageFamily: input.knownPage.pageFamily as CollectedPageArtifact["pageManifest"]["pageFamily"],
    pageTitleNormalized: input.knownPage.pageTitleNormalized,
    discoveryMethod: input.knownPage.discoveryMethod,
    discoveredFromUrl: input.knownPage.discoveredFromUrl,
    httpStatus: input.httpStatus,
    contentType: input.knownPage.contentType,
    etag: input.knownPage.etag,
    lastModified: input.knownPage.lastModified,
    responseBodyHash:
      input.disposition === "not_modified" ? input.knownPage.responseBodyHash : null,
    mainContentHash:
      input.disposition === "not_modified" ? input.knownPage.mainContentHash : null,
    disposition: input.disposition,
    observedAt: input.observedAt,
  });
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

function buildListingRequeueRequests(input: {
  bundle: OfficialWebConfigBundle;
  depth: number;
  hostPolicy: OfficialWebHostPolicy;
  hostSummary: OfficialWebHostSummaryRecord;
  knownPage?: OfficialWebPlannerPageCandidate;
  page: CollectedPageArtifact;
  plannerPageLookup: Map<string, OfficialWebPlannerPageCandidate>;
  robotsState: CollectorRobotsState;
}): Array<{ url: string; uniqueKey: string; userData: CollectorRequestUserData }> {
  if (!shouldPromoteListingRequeue({ knownPage: input.knownPage, page: input.page })) {
    return [];
  }

  const requests = new Map<string, { url: string; uniqueKey: string; userData: CollectorRequestUserData }>();
  const maxPromotedLinks = Math.min(25, Math.max(5, Math.floor(input.page.discoveredLinks.length / 2)));

  for (const link of input.page.discoveredLinks) {
    if (!link.admitted || !link.normalizedUrl || link.normalizedUrl === input.page.pageManifest.normalizedCanonicalUrl) {
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
    requests.set(link.normalizedUrl, {
      url: link.normalizedUrl,
      uniqueKey: link.normalizedUrl,
      userData: {
        discoveryMethod: "manual_requeue",
        conditionalHeaders: buildConditionalHeaders(knownPage),
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

async function buildDynamicShellRequeueRequests(input: {
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

    const requests = new Map<string, { url: string; uniqueKey: string; userData: CollectorRequestUserData }>();
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
      requests.set(url, {
        url,
        uniqueKey: url,
        userData: {
          discoveryMethod: "manual_requeue",
          conditionalHeaders: buildConditionalHeaders(knownPage),
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

function isRepairableStatusCode(statusCode: number | null): boolean {
  return statusCode === 429 || (statusCode != null && statusCode >= 500);
}

async function loadSitemapUrls(urls: string[]): Promise<string[]> {
  if (urls.length === 0) {
    return [];
  }
  const sitemap = await Sitemap.load(urls);
  return sitemap.urls;
}

function buildRunArtifacts(payload: {
  crawlRun: ReturnType<typeof buildOfficialWebCrawlRunRecord>;
  hostSummary: ReturnType<typeof buildOfficialWebHostSummaryDocument>;
  sourceTruthBundle: OfficialWebSourceTruthBundle;
  qualityAudit: OfficialWebQualityAuditDocument;
  pageObservations: OfficialWebPageObservationRecord[];
  urlResults: OfficialWebUrlResultRecord[];
  failures: OfficialWebFailureRecord[];
  dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[];
}): RunArtifactDescriptor[] {
  return [
    {
      artifactName: "crawl-run.json",
      contentType: "application/json",
      data: encodeJson(payload.crawlRun),
      recordCount: 1,
    },
    {
      artifactName: "host-summary.json",
      contentType: "application/json",
      data: encodeJson(payload.hostSummary),
      recordCount: payload.hostSummary.hosts.length,
    },
    {
      artifactName: "url-results.jsonl",
      contentType: "application/x-ndjson",
      data: encodeText(toJsonLines(payload.urlResults)),
      recordCount: payload.urlResults.length,
    },
    {
      artifactName: "failures.jsonl",
      contentType: "application/x-ndjson",
      data: encodeText(toJsonLines(payload.failures)),
      recordCount: payload.failures.length,
    },
    {
      artifactName: OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
      contentType: "application/json",
      data: encodeJson(payload.sourceTruthBundle),
      recordCount: payload.sourceTruthBundle.pages.length,
    },
    {
      artifactName: OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
      contentType: "application/json",
      data: encodeJson(payload.qualityAudit),
      recordCount: payload.qualityAudit.pages.length,
    },
    {
      artifactName: OFFICIAL_WEB_PAGE_OBSERVATIONS_ARTIFACT,
      contentType: "application/x-ndjson",
      data: encodeText(toJsonLines(payload.pageObservations)),
      recordCount: payload.pageObservations.length,
    },
    ...buildDynamicShellDiscoveryAuditArtifacts(payload.dynamicShellDiscoveryAudits),
  ];
}

function buildDynamicShellDiscoveryAuditArtifacts(
  audits: OfficialWebDynamicShellDiscoveryAudit[],
): RunArtifactDescriptor[] {
  if (audits.length === 0) {
    return [];
  }

  return [
    {
      artifactName: OFFICIAL_WEB_DYNAMIC_SHELL_DISCOVERY_AUDIT_ARTIFACT,
      contentType: "application/x-ndjson",
      data: encodeText(toJsonLines(audits)),
      recordCount: audits.length,
    },
  ];
}

function writeCollectorArtifacts(
  outputDir: string,
  payload: {
    runArtifacts: RunArtifactDescriptor[];
    pages: CollectedPageArtifact[];
  },
): Record<string, string> {
  const artifactPaths: Record<string, string> = {};

  for (const runArtifact of payload.runArtifacts) {
    const artifactPath = resolve(outputDir, runArtifact.artifactName);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, runArtifact.data);
    artifactPaths[runArtifact.artifactName] = artifactPath;
  }

  for (const page of payload.pages) {
    for (const file of page.files) {
      const localPath = resolve(outputDir, "source-assets", page.rawAssetId, page.rawVersionId, file.relativePath);
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, file.data);
    }
  }

  return artifactPaths;
}

async function uploadCollectorArtifacts(input: {
  siteId: string;
  crawlRunId: string;
  artifactStore: OfficialWebArtifactStore;
  runArtifacts: RunArtifactDescriptor[];
  pages: CollectedPageArtifact[];
}): Promise<{ uploadedArtifacts: OfficialWebRunArtifactRef[]; artifactUploadCount: number }> {
  const uploadedArtifacts: OfficialWebRunArtifactRef[] = [];
  let artifactUploadCount = 0;

  for (const runArtifact of input.runArtifacts) {
    const objectKey = buildOfficialWebRunArtifactKey({
      siteId: input.siteId,
      crawlRunId: input.crawlRunId,
      artifactName: runArtifact.artifactName,
    });
    const stored = await input.artifactStore.putObject({
      objectKey,
      data: runArtifact.data,
      contentType: runArtifact.contentType,
      recordCount: runArtifact.recordCount,
    });
    artifactUploadCount += 1;
    uploadedArtifacts.push({
      artifactType: resolveOfficialWebRunArtifactType(runArtifact.artifactName),
      objectKey: stored.objectKey,
      contentSha256: stored.contentSha256,
      byteSize: stored.byteSize,
      recordCount: stored.recordCount,
    });
  }

  for (const page of input.pages) {
    for (const file of page.files) {
      await input.artifactStore.putObject({
        objectKey: file.objectKey,
        data: file.data,
        contentType: file.contentType,
        recordCount: file.recordCount,
      });
      artifactUploadCount += 1;
    }
  }

  return {
    uploadedArtifacts,
    artifactUploadCount,
  };
}

function buildRunSourceTruthBundle(
  siteId: string,
  crawlRunId: string,
  pages: CollectedPageArtifact[],
): OfficialWebSourceTruthBundle {
  return buildOfficialWebSourceTruthBundle({
    siteId,
    crawlRunId,
    pages: pages.map((page) => ({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
      pageFamily: page.pageManifest.pageFamily,
      pageManifestObjectKey: findPageFileObjectKey(page, "source-truth/page-manifest.json"),
      contentBlocksObjectKey: findPageFileObjectKey(page, "source-truth/content-blocks.jsonl"),
      providerExtractionObjectKey: findPageFileObjectKey(
        page,
        "provider/cheerio-basic/page-extraction.json",
      ),
      discoveredLinksObjectKey: findPageFileObjectKey(
        page,
        "provider/cheerio-basic/discovered-links.jsonl",
      ),
      responseHtmlObjectKey: findPageFileObjectKey(page, "capture/response.html"),
      responseBodyHash: page.pageManifest.responseBodyHash,
      blockCount: page.contentBlocks.length,
    })),
  });
}

function buildPageObservations(input: {
  siteId: string;
  crawlRunId: string;
  runIntent: OfficialWebRunIntent;
  pages: CollectedPageArtifact[];
}): OfficialWebPageObservationRecord[] {
  return input.pages.map((page) =>
    buildPageObservationFromCollectedPage(input.siteId, input.crawlRunId, input.runIntent, page),
  );
}

function dedupeCollectedPages(pages: CollectedPageArtifact[]): CollectedPageArtifact[] {
  const byIdentity = new Map<string, CollectedPageArtifact>();

  for (const page of pages) {
    byIdentity.set(buildCollectedPageIdentityKey(page), page);
  }

  return [...byIdentity.values()];
}

function buildCollectedPageIdentityKey(page: CollectedPageArtifact): string {
  return `${page.rawAssetId}::${page.rawVersionId}`;
}

function dedupePageObservations(
  observations: OfficialWebPageObservationRecord[],
): OfficialWebPageObservationRecord[] {
  const byIdentity = new Map<string, OfficialWebPageObservationRecord>();

  for (const observation of observations) {
    byIdentity.set(buildPageObservationIdentityKey(observation), observation);
  }

  return [...byIdentity.values()];
}

function buildPageObservationIdentityKey(
  observation: OfficialWebPageObservationRecord,
): string {
  return [
    observation.normalizedCanonicalUrl,
    observation.disposition,
    observation.rawAssetId ?? "",
    observation.rawVersionId ?? "",
    observation.responseBodyHash ?? "",
    observation.mainContentHash ?? "",
    observation.httpStatus == null ? "" : String(observation.httpStatus),
  ].join("::");
}

function findPageFileObjectKey(page: CollectedPageArtifact, relativePath: string): string {
  const file = page.files.find((item) => item.relativePath === relativePath);
  if (!file) {
    throw new Error(`missing page artifact ${relativePath} for ${page.rawAssetId}/${page.rawVersionId}`);
  }
  return file.objectKey;
}

function summarizeProgressCounts(
  aggregatedResults: CollectorAggregatedResults,
  artifactUploadCount: number,
): CollectorProgressCounts {
  return {
    urlsDiscovered: aggregatedResults.urlResults.length,
    urlsFetched: aggregatedResults.urlResults.filter((item) => item.outcome === "fetched").length,
    pagesNormalized: aggregatedResults.pages.length,
    artifactUploads: artifactUploadCount,
    failures: aggregatedResults.failures.length,
  };
}

function emptyProgressCounts(): CollectorProgressCounts {
  return {
    urlsDiscovered: 0,
    urlsFetched: 0,
    pagesNormalized: 0,
    artifactUploads: 0,
    failures: 0,
  };
}

function sameProgressCounts(a: CollectorProgressCounts, b: CollectorProgressCounts): boolean {
  return (
    a.urlsDiscovered === b.urlsDiscovered &&
    a.urlsFetched === b.urlsFetched &&
    a.pagesNormalized === b.pagesNormalized &&
    a.artifactUploads === b.artifactUploads &&
    a.failures === b.failures
  );
}

function countUniqueRawAssets(pages: CollectedPageArtifact[]): number {
  return new Set(pages.map((item) => item.rawAssetId)).size;
}

function buildSelectedHosts(plan: OfficialWebCrawlPlan, hostFilter?: string[]): OfficialWebCrawlPlan["enabledHosts"] {
  if (hostFilter == null || hostFilter.length === 0) {
    return plan.enabledHosts;
  }

  const normalizedFilter = hostFilter.map((item) => item.toLowerCase());
  const enabledHostSet = new Set(plan.enabledHosts.map((item) => item.host.toLowerCase()));
  const unknownHosts = normalizedFilter.filter((item, index) => {
    if (!enabledHostSet.has(item)) {
      return normalizedFilter.indexOf(item) === index;
    }
    return false;
  });

  if (unknownHosts.length > 0) {
    throw new Error(`hostFilter references unknown or disabled hosts: ${unknownHosts.join(", ")}`);
  }

  const requestedHosts = new Set(normalizedFilter);
  return plan.enabledHosts.filter((item) => requestedHosts.has(item.host.toLowerCase()));
}

function buildHostRequestQueueName(crawlRunId: string, host: string): string {
  const normalizedHost = host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `official-web-${crawlRunId}-${normalizedHost}`;
}

function defaultCollectorOutputDir(siteId: string, crawlRunId: string): string {
  return resolve(defaultRepoRoot(), ".tmp", "official-web", siteId, crawlRunId);
}

function buildRobotsUserAgent(bundle: OfficialWebConfigBundle): string {
  return bundle.site.userAgent.split(/[ /]/, 1)[0] ?? bundle.site.userAgent;
}

function extractDeclaredCanonicalUrl(context: CheerioCrawlingContext): string | null {
  const cheerioRoot = (context as CheerioCrawlingContext & { $?: CheerioCrawlingContext["$"] }).$;
  if (typeof cheerioRoot === "function") {
    const htmlCanonical = cheerioRoot("link[rel='canonical']").first().attr("href");
    if (typeof htmlCanonical === "string" && htmlCanonical.trim().length > 0) {
      return htmlCanonical.trim();
    }
  }

  const linkHeader = context.response.headers.link;
  const candidate =
    typeof linkHeader === "string" ? linkHeader : Array.isArray(linkHeader) ? linkHeader[0] : null;
  if (typeof candidate !== "string") {
    return null;
  }

  const match = candidate.match(/<([^>]+)>\s*;\s*rel="?canonical"?/i);
  return match?.[1] ?? null;
}

function resolveUrlOutcome(
  statusCode: number | null,
  contentType: string,
): OfficialWebUrlResultOutcome {
  if (statusCode === 304) {
    return "not_modified";
  }
  if (statusCode === 404 || statusCode === 410) {
    return "deleted";
  }
  if (statusCode != null && statusCode >= 400) {
    return "http_error";
  }
  if (contentType !== "text/html") {
    return "unsupported_content_type";
  }
  return "fetched";
}

function resolveResponseBody(context: CheerioCrawlingContext): string {
  const maybeBody = (context as unknown as { body?: unknown }).body;
  if (typeof maybeBody === "string") {
    return maybeBody;
  }
  if (maybeBody instanceof Buffer) {
    return maybeBody.toString("utf-8");
  }
  const html = context.$.html();
  return typeof html === "string" ? html : "";
}

function toJsonLines(records: ReadonlyArray<object>): string {
  if (records.length === 0) {
    return "";
  }
  return `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function encodeJson(value: object): Uint8Array {
  return encodeText(JSON.stringify(value, null, 2));
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function parseRunIntent(value: string | undefined): OfficialWebRunIntent | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "baseline" || value === "hot" || value === "repair") {
    return value;
  }

  throw new Error("--run-intent must be one of: baseline, hot, repair");
}

function parseTriggerType(value: string | undefined): OfficialWebTriggerType | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "manual" || value === "scheduled" || value === "replay") {
    return value;
  }

  throw new Error("--trigger-type must be one of: manual, scheduled, replay");
}

function buildConfiguredControlPlaneClient(input: {
  appApiBaseUrl?: string;
  serviceToken?: string;
}): OfficialWebControlPlaneClient {
  if (!input.appApiBaseUrl || !input.serviceToken) {
    throw new Error(
      "--app-api-base-url/OFFICIAL_WEB_APP_API_BASE_URL and --service-token/OFFICIAL_WEB_SERVICE_TOKEN must be provided together.",
    );
  }

  return createOfficialWebControlPlaneClient({
    appApiBaseUrl: input.appApiBaseUrl,
    serviceToken: input.serviceToken,
  });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  await crawlMain();
}
