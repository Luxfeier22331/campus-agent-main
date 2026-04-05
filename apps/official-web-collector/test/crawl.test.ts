import { load } from "cheerio";
import { existsSync, readFileSync } from "node:fs";

import {
  buildOfficialWebCrawlPlan,
  findOfficialWebHostPolicy,
  loadOfficialWebConfig,
} from "official-web-core";
import { describe, expect, it } from "vitest";

import * as collector from "../src/index";
import { SAMPLE_DYNAMIC_SHELL_PAGE_HTML, SAMPLE_PAGE_HTML, writeTestConfigRoot } from "./test-support";
import * as pageArtifactsModule from "../src/page-artifacts";

describe("official-web-collector crawl shell", () => {
  it("writes stable local artifacts from host crawl results", async () => {
    const crawlSite = (
      collector as unknown as {
        crawlSite?: (
          siteId: string,
          options: {
            configRoot: string;
            outputDir: string;
            crawlRunId: string;
            crawlHosts?: (input: {
              dynamicPlan: {
                duePages: Array<{ normalizedCanonicalUrl: string }>;
              };
            }) => Promise<{
              hostSummaries: Array<{
                host: string;
                pagesObserved: number;
                pagesFetched: number;
                failures: number;
                admissionRejected: number;
                robotsBlocked: boolean;
              }>;
              pageObservations?: Array<unknown>;
              urlResults: Array<unknown>;
              failures: Array<unknown>;
              pages: Array<unknown>;
            }>;
          },
        ) => Promise<{
          outputDir: string;
          artifactPaths: Record<string, string>;
          crawlRun: { status: string; runIntent: string };
          pageObservations: Array<{ normalizedCanonicalUrl: string; runIntent: string }>;
        }>;
      }
    ).crawlSite;

    expect(crawlSite).toBeTypeOf("function");
    if (!crawlSite) {
      return;
    }

    const { configRoot, outputDir } = writeTestConfigRoot();
    const result = await crawlSite("campus_public", {
      configRoot,
      outputDir,
      crawlRunId: "campus_public-TEST",
      crawlHosts: async () => ({
        hostSummaries: [
          {
            host: "www.example.edu",
            pagesObserved: 2,
            pagesFetched: 1,
            failures: 1,
            admissionRejected: 0,
            robotsBlocked: false,
          },
        ],
        urlResults: [
          {
            schemaVersion: "official_web_url_result.v1",
            siteId: "campus_public",
            crawlRunId: "campus_public-TEST",
            observedAt: "2026-03-28T16:00:00.000Z",
            requestedUrl: "https://www.example.edu/",
            finalUrl: "https://www.example.edu/",
            declaredCanonicalUrl: null,
            normalizedCanonicalUrl: "https://www.example.edu/",
            urlIdentityBasis: "final_url",
            discoveryMethod: "seed",
            discoveredFromUrl: null,
            host: "www.example.edu",
            depth: 0,
            httpStatus: 200,
            contentType: "text/html",
            outcome: "fetched",
          },
        ],
        pageObservations: [],
        failures: [
          {
            schemaVersion: "official_web_failure.v1",
            siteId: "campus_public",
            crawlRunId: "campus_public-TEST",
            observedAt: "2026-03-28T16:01:00.000Z",
            host: "www.example.edu",
            url: "https://www.example.edu/broken",
            phase: "fetch",
            reason: "timeout",
            message: "request timed out",
            retryable: true,
          },
        ],
        pages: [],
      }),
    });

    expect(result.outputDir).toBe(outputDir);
    expect(result.crawlRun.status).toBe("completed_with_errors");
    expect(result.crawlRun.runIntent).toBe("baseline");
    expect(result.pageObservations).toEqual([]);

    const crawlRun = JSON.parse(readFileSync(result.artifactPaths["crawl-run.json"], "utf-8")) as {
      status: string;
      counters: { failures: number };
    };
    const hostSummary = JSON.parse(
      readFileSync(result.artifactPaths["host-summary.json"], "utf-8"),
    ) as {
      hosts: Array<{ host: string; pagesFetched: number }>;
    };
    const urlResults = readFileSync(result.artifactPaths["url-results.jsonl"], "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{ normalizedCanonicalUrl: string }>;
    const failures = readFileSync(result.artifactPaths["failures.jsonl"], "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{ reason: string }>;
    const qualityAudit = JSON.parse(
      readFileSync(result.artifactPaths["quality-audit.json"], "utf-8"),
    ) as {
      summary: { totalPages: number; passPages: number };
    };

    expect(crawlRun.status).toBe("completed_with_errors");
    expect(crawlRun.counters.failures).toBe(1);
    expect(hostSummary.hosts).toHaveLength(1);
    expect(hostSummary.hosts[0]?.host).toBe("www.example.edu");
    expect(hostSummary.hosts[0]?.pagesFetched).toBe(1);
    expect(urlResults[0]?.normalizedCanonicalUrl).toBe("https://www.example.edu/");
    expect(failures[0]?.reason).toBe("timeout");
    expect(qualityAudit.summary.totalPages).toBe(0);
    expect(qualityAudit.summary.passPages).toBe(0);
  });

  it("deduplicates repeated fetched page artifacts before building bundle and quality audit", async () => {
    const crawlSite = (
      collector as unknown as {
        crawlSite?: (
          siteId: string,
          options: {
            configRoot: string;
            outputDir: string;
            crawlRunId: string;
            crawlHosts?: () => Promise<{
              hostSummaries: Array<{
                host: string;
                pagesObserved: number;
                pagesFetched: number;
                failures: number;
                admissionRejected: number;
                robotsBlocked: boolean;
              }>;
              pageObservations?: Array<{
                disposition: string;
                normalizedCanonicalUrl: string;
                pageFamily: string;
                rawAssetId: string | null;
                rawVersionId: string | null;
                runIntent: string;
              }>;
              urlResults: Array<unknown>;
              failures: Array<unknown>;
              pages: Array<unknown>;
            }>;
          },
        ) => Promise<{
          sourceTruthBundle: { pages: Array<{ normalizedCanonicalUrl: string }> };
          qualityAudit: { summary: { reviewPages: number; totalPages: number } };
          pageObservations: Array<{ normalizedCanonicalUrl: string; rawAssetId: string | null }>;
          pages: Array<{ rawAssetId: string; rawVersionId: string }>;
        }>;
      }
    ).crawlSite;
    const buildCollectedPageArtifacts = (
      pageArtifactsModule as unknown as {
        buildCollectedPageArtifacts?: typeof pageArtifactsModule.buildCollectedPageArtifacts;
      }
    ).buildCollectedPageArtifacts;

    expect(crawlSite).toBeTypeOf("function");
    expect(buildCollectedPageArtifacts).toBeTypeOf("function");
    if (!crawlSite || !buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot, outputDir } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_duplicate_fetch",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifact = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/",
      finalUrl: "https://www.example.edu/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-01T09:00:00.000Z",
      html: load(SAMPLE_DYNAMIC_SHELL_PAGE_HTML),
    });

    const result = await crawlSite("campus_public", {
      configRoot,
      outputDir,
      crawlRunId: "owrun_duplicate_fetch",
      crawlHosts: async () => ({
        hostSummaries: [
          {
            host: "www.example.edu",
            pagesObserved: 2,
            pagesFetched: 2,
            failures: 0,
            admissionRejected: 0,
            robotsBlocked: false,
          },
        ],
        pageObservations: [
          {
            disposition: "fetched",
            normalizedCanonicalUrl: "https://www.example.edu/",
            pageFamily: "dynamic_shell_page",
            rawAssetId: pageArtifact.rawAssetId,
            rawVersionId: pageArtifact.rawVersionId,
            runIntent: "baseline",
          },
          {
            disposition: "fetched",
            normalizedCanonicalUrl: "https://www.example.edu/",
            pageFamily: "dynamic_shell_page",
            rawAssetId: pageArtifact.rawAssetId,
            rawVersionId: pageArtifact.rawVersionId,
            runIntent: "baseline",
          },
        ],
        urlResults: [
          {
            schemaVersion: "official_web_url_result.v1",
            siteId: "campus_public",
            crawlRunId: "owrun_duplicate_fetch",
            observedAt: "2026-04-01T09:00:00.000Z",
            requestedUrl: "https://www.example.edu/",
            finalUrl: "https://www.example.edu/",
            declaredCanonicalUrl: null,
            normalizedCanonicalUrl: "https://www.example.edu/",
            urlIdentityBasis: "final_url",
            discoveryMethod: "seed",
            discoveredFromUrl: null,
            host: "www.example.edu",
            depth: 0,
            httpStatus: 200,
            contentType: "text/html",
            outcome: "fetched",
          },
          {
            schemaVersion: "official_web_url_result.v1",
            siteId: "campus_public",
            crawlRunId: "owrun_duplicate_fetch",
            observedAt: "2026-04-01T09:00:30.000Z",
            requestedUrl: "https://www.example.edu/",
            finalUrl: "https://www.example.edu/",
            declaredCanonicalUrl: null,
            normalizedCanonicalUrl: "https://www.example.edu/",
            urlIdentityBasis: "final_url",
            discoveryMethod: "seed",
            discoveredFromUrl: null,
            host: "www.example.edu",
            depth: 0,
            httpStatus: 200,
            contentType: "text/html",
            outcome: "fetched",
          },
        ],
        failures: [],
        pages: [pageArtifact, pageArtifact],
      }),
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pageObservations).toHaveLength(1);
    expect(result.sourceTruthBundle.pages).toHaveLength(1);
    expect(result.sourceTruthBundle.pages[0]?.normalizedCanonicalUrl).toBe("https://www.example.edu/");
    expect(result.qualityAudit.summary.totalPages).toBe(1);
    expect(result.qualityAudit.summary.reviewPages).toBe(1);
  });

  it("uploads page artifacts and reports run lifecycle through the control plane", async () => {
    const crawlSite = (
      collector as unknown as {
        crawlSite?: (
          siteId: string,
          options: {
            configRoot: string;
            outputDir: string;
            crawlRunId: string;
            schedulerRunKey: string;
            runIntent?: string;
            artifactStore: {
              putObject: (input: {
                objectKey: string;
                data: Uint8Array;
                contentType: string;
                recordCount?: number;
              }) => Promise<{
                objectKey: string;
                contentSha256: string;
                byteSize: number;
                recordCount?: number;
              }>;
            };
            controlPlaneClient: {
              startRun: (input: Record<string, unknown>) => Promise<{
                run: { runId: string; siteId: string; status: string; startedAt: string };
              }>;
              resolvePlan: (input: Record<string, unknown>) => Promise<{
                plan: {
                  duePages: Array<{ normalizedCanonicalUrl: string }>;
                  resolvedAt: string;
                  summary: Record<string, number>;
                };
              }>;
              sendHeartbeat: (input: Record<string, unknown>) => Promise<{
                run: { runId: string; status: string };
              }>;
              finalizeRun: (input: Record<string, unknown>) => Promise<{
                run: { runId: string; status: string; ingestionDispatchStatus: string };
              }>;
            };
            crawlHosts?: (input: {
              dynamicPlan: {
                duePages: Array<{ normalizedCanonicalUrl: string }>;
              };
              reportProgress?: (counts: {
                urlsDiscovered: number;
                urlsFetched: number;
                pagesNormalized: number;
                artifactUploads: number;
                failures: number;
              }) => Promise<void>;
            }) => Promise<{
              hostSummaries: Array<unknown>;
              pageObservations?: Array<unknown>;
              urlResults: Array<unknown>;
              failures: Array<unknown>;
              pages: Array<unknown>;
            }>;
          },
        ) => Promise<{
          artifactPaths: Record<string, string>;
          uploadedArtifacts: Array<{ artifactType: string; objectKey: string }>;
          crawlRun: { crawlRunId: string; status: string; runIntent: string };
          pageObservations: Array<{ runIntent: string; normalizedCanonicalUrl: string }>;
        }>;
      }
    ).crawlSite;

    expect(crawlSite).toBeTypeOf("function");
    const buildCollectedPageArtifacts = (
      pageArtifactsModule as unknown as {
        buildCollectedPageArtifacts?: typeof pageArtifactsModule.buildCollectedPageArtifacts;
      }
    ).buildCollectedPageArtifacts;
    expect(buildCollectedPageArtifacts).toBeTypeOf("function");
    if (!crawlSite || !buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot, outputDir } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_01JQTEST",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
    expect(hostPolicy).not.toBeNull();
    const uploads: Array<{ objectKey: string; contentType: string; recordCount?: number }> = [];
    const lifecycle = {
      resolvedPlan: null as Record<string, unknown> | null,
      started: null as Record<string, unknown> | null,
      heartbeats: [] as Array<Record<string, unknown>>,
      finalized: null as Record<string, unknown> | null,
    };
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/admissions?id=9",
      finalUrl: "https://www.example.edu/admissions?id=9",
      declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
      responseBody: SAMPLE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:00:00.000Z",
      html: load(SAMPLE_PAGE_HTML),
    });

    const result = await crawlSite("campus_public", {
      configRoot,
      outputDir,
      crawlRunId: "owrun_local_seed",
      schedulerRunKey: "cron-2026-03-29T08:00:00Z",
      runIntent: "hot",
      artifactStore: {
        async putObject(input) {
          uploads.push({
            objectKey: input.objectKey,
            contentType: input.contentType,
            recordCount: input.recordCount,
          });
          return {
            objectKey: input.objectKey,
            contentSha256: `sha-${uploads.length}`,
            byteSize: input.data.byteLength,
            recordCount: input.recordCount,
          };
        },
      },
      controlPlaneClient: {
        async startRun(input) {
          lifecycle.started = input;
          return {
            run: {
              runId: "owrun_01JQTEST",
              siteId: "campus_public",
              status: "accepted",
              startedAt: "2026-03-29T08:00:00.000Z",
            },
          };
        },
        async resolvePlan(input) {
          lifecycle.resolvedPlan = input;
          return {
            plan: {
              duePages: [
                {
                  normalizedCanonicalUrl: "https://www.example.edu/news/",
                },
              ],
              resolvedAt: "2026-03-29T08:00:00.000Z",
              summary: {
                duePages: 1,
              },
            },
          };
        },
        async sendHeartbeat(input) {
          lifecycle.heartbeats.push(input);
          return {
            run: {
              runId: "owrun_01JQTEST",
              status: "running",
            },
          };
        },
        async finalizeRun(input) {
          lifecycle.finalized = input;
          return {
            run: {
              runId: "owrun_01JQTEST",
              status: "completed",
              ingestionDispatchStatus: "queued",
            },
          };
        },
      },
      crawlHosts: async ({ dynamicPlan, reportProgress }) => {
        expect(dynamicPlan.duePages).toEqual([
          {
            normalizedCanonicalUrl: "https://www.example.edu/news/",
          },
        ]);
        if (reportProgress) {
          await reportProgress({
            urlsDiscovered: 1,
            urlsFetched: 1,
            pagesNormalized: 1,
            artifactUploads: 0,
            failures: 0,
          });
        }

        return {
          hostSummaries: [
            {
              host: "www.example.edu",
              pagesObserved: 1,
              pagesFetched: 1,
              failures: 0,
              admissionRejected: 0,
              robotsBlocked: false,
            },
          ],
          pageObservations: [
            {
              contentType: "text/html",
              crawlRunId: "owrun_01JQTEST",
              discoveredFromUrl: null,
              discoveryMethod: "seed",
              disposition: "fetched",
              etag: "etag-1",
              finalUrl: "https://www.example.edu/admissions?id=9",
              host: "www.example.edu",
              httpStatus: 200,
              mainContentHash: "main-1",
              normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
              observedAt: "2026-03-29T08:00:00.000Z",
              pageFamily: "article_detail",
              pageTitleNormalized: "Admissions",
              rawAssetId: "raw_01",
              rawVersionId: "rawv_01",
              requestedUrl: "https://www.example.edu/admissions?id=9",
              responseBodyHash: "body-1",
              runIntent: "hot",
              schemaVersion: "official_web_page_observation.v1",
              siteId: "campus_public",
            },
          ],
          urlResults: [
            {
              schemaVersion: "official_web_url_result.v1",
              siteId: "campus_public",
              crawlRunId: "owrun_01JQTEST",
              observedAt: "2026-03-29T08:00:00.000Z",
              requestedUrl: "https://www.example.edu/admissions?id=9",
              finalUrl: "https://www.example.edu/admissions?id=9",
              declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
              normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
              urlIdentityBasis: "declared_canonical",
              discoveryMethod: "seed",
              discoveredFromUrl: null,
              host: "www.example.edu",
              depth: 0,
              httpStatus: 200,
              contentType: "text/html",
              outcome: "fetched",
            },
          ],
          failures: [],
          pages: [pageArtifacts],
        };
      },
    });

    expect(result.crawlRun.crawlRunId).toBe("owrun_01JQTEST");
    expect(result.crawlRun.status).toBe("completed");
    expect(result.crawlRun.runIntent).toBe("hot");
    expect(result.pageObservations).toHaveLength(1);
    expect(result.pageObservations[0]).toMatchObject({
      runIntent: "hot",
      normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
    });
    expect(lifecycle.started?.schedulerRunKey).toBe("cron-2026-03-29T08:00:00Z");
    expect(lifecycle.resolvedPlan).toMatchObject({
      runIntent: "hot",
      siteId: "campus_public",
    });
    expect(lifecycle.started?.runIntent).toBe("hot");
    expect(lifecycle.heartbeats).toHaveLength(2);
    expect(lifecycle.heartbeats[1]?.counts).toMatchObject({
      artifactUploads: uploads.length,
      pagesNormalized: 1,
      urlsFetched: 1,
    });
    expect(
      lifecycle.finalized && Array.isArray((lifecycle.finalized as { artifacts?: unknown[] }).artifacts)
        ? ((lifecycle.finalized as { artifacts: Array<{ artifactType: string }> }).artifacts ?? []).some(
            (item) => item.artifactType === "source_truth_bundle",
          )
        : false,
    ).toBe(true);
    expect(
      lifecycle.finalized &&
        Array.isArray((lifecycle.finalized as { pageObservations?: unknown[] }).pageObservations)
        ? ((lifecycle.finalized as { pageObservations: Array<{ normalizedCanonicalUrl: string }> })
            .pageObservations ?? []
          ).some((item) => item.normalizedCanonicalUrl === "https://www.example.edu/admissions?id=9")
        : false,
    ).toBe(true);
    expect(uploads.map((item) => item.objectKey)).toEqual(
      expect.arrayContaining([
        "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
        "official_web/campus_public/runs/owrun_01JQTEST/source-truth-bundle.json",
        "official_web/campus_public/runs/owrun_01JQTEST/quality-audit.json",
      ]),
    );
    expect(result.uploadedArtifacts.map((item) => item.artifactType)).toEqual(
      expect.arrayContaining(["source_truth_bundle", "quality_audit", "page_observations"]),
    );
    expect(existsSync(result.artifactPaths["source-truth-bundle.json"])).toBe(true);
    expect(existsSync(result.artifactPaths["quality-audit.json"])).toBe(true);
    expect(existsSync(result.artifactPaths["page-observations.jsonl"])).toBe(true);
    expect(
      readFileSync(result.artifactPaths["source-truth-bundle.json"], "utf-8"),
    ).toContain("\"schemaVersion\": \"official_web_source_truth_bundle.v1\"");
    expect(
      readFileSync(result.artifactPaths["quality-audit.json"], "utf-8"),
    ).toContain("\"schemaVersion\": \"official_web_quality_audit.v1\"");
    expect(
      readFileSync(result.artifactPaths["page-observations.jsonl"], "utf-8"),
    ).toContain("\"schemaVersion\":\"official_web_page_observation.v1\"");
  });

  it("resolves crawl CLI input from env-backed control-plane settings", () => {
    const resolveCollectorCrawlMainInput = (
      collector as unknown as {
        resolveCollectorCrawlMainInput?: (
          argv: string[],
          env: Record<string, string | undefined>,
        ) => {
          siteId: string;
          options: {
            artifactStore?: unknown;
            controlPlaneClient?: unknown;
            runIntent?: string;
            traceId?: string;
            triggerType?: string;
          };
        };
      }
    ).resolveCollectorCrawlMainInput;

    expect(resolveCollectorCrawlMainInput).toBeTypeOf("function");
    if (!resolveCollectorCrawlMainInput) {
      return;
    }

    const result = resolveCollectorCrawlMainInput(
      ["--site-id", "campus_public", "--crawl-run-id", "owrun_manual"],
      {
        OFFICIAL_WEB_APP_API_BASE_URL: "https://app-api.internal",
        OFFICIAL_WEB_SERVICE_TOKEN: "service-token",
        OFFICIAL_WEB_RUN_INTENT: "repair",
        OFFICIAL_WEB_TRACE_ID: "trace_01JQ",
        OFFICIAL_WEB_TRIGGER_TYPE: "scheduled",
        OBJECT_STORE_ENDPOINT: "http://localhost:9000",
        OBJECT_STORE_ACCESS_KEY: "minioadmin",
        OBJECT_STORE_SECRET_KEY: "minioadmin",
        OBJECT_STORE_BUCKET_SOURCE: "campus-rag-source",
      },
    );

    expect(result.siteId).toBe("campus_public");
    expect(result.options.runIntent).toBe("repair");
    expect(result.options.triggerType).toBe("scheduled");
    expect(result.options.traceId).toBe("trace_01JQ");
    expect(result.options.controlPlaneClient).toBeDefined();
    expect(result.options.artifactStore).toBeDefined();
  });

  it("fails closed when control-plane config is partially provided", () => {
    const resolveCollectorCrawlMainInput = (
      collector as unknown as {
        resolveCollectorCrawlMainInput?: (
          argv: string[],
          env: Record<string, string | undefined>,
        ) => unknown;
      }
    ).resolveCollectorCrawlMainInput;

    expect(resolveCollectorCrawlMainInput).toBeTypeOf("function");
    if (!resolveCollectorCrawlMainInput) {
      return;
    }

    expect(() =>
      resolveCollectorCrawlMainInput(["--site-id", "campus_public"], {
        OFFICIAL_WEB_APP_API_BASE_URL: "https://app-api.internal",
      }),
    ).toThrowError(/OFFICIAL_WEB_APP_API_BASE_URL.*OFFICIAL_WEB_SERVICE_TOKEN/);
  });

});
