import { expect, it } from "vitest";

import {
	createCollectedPageArtifactForTest,
	createTargetWorksetControlPlaneForTest,
	getCrawlSite,
	readJsonArtifact,
	readJsonlArtifact,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	writeTestConfigRoot,
} from "./crawl-test-support";

export function registerCrawlCoreSuite() {
	it("fails closed when programmatic crawl lacks target workset admission", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();
		let crawlHostsCalled = false;

		await expect(
			crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_missing_admission",
				crawlHosts: async () => {
					crawlHostsCalled = true;
					return {
						hostSummaries: [],
						pageObservations: [],
						urlResults: [],
						failures: [],
						pages: [],
					};
				},
			}),
		).rejects.toThrow(/requires app-api target workset admission/u);
		expect(crawlHostsCalled).toBe(false);
	});

	it("does not treat hostFilter as collection admission", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();

		await expect(
			crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_host_filter_without_admission",
				hostFilter: ["www.example.edu"],
				crawlHosts: async () => {
					throw new Error("crawl should not start without admission");
				},
			}),
		).rejects.toThrow(/hostFilter cannot create target scope/u);
	});

	it("writes stable local artifacts from host crawl results", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();
		const result = (await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "campus_public-TEST",
			localArtifactsOnly: true,
			controlPlaneClient: createTargetWorksetControlPlaneForTest({
				runId: "campus_public-TEST",
			}),
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
		})) as {
			artifactPaths: Record<string, string>;
			crawlRun: { runIntent: string; status: string };
			outputDir: string;
			pageObservations: unknown[];
		};

		expect(result.outputDir).toBe(outputDir);
		expect(result.crawlRun.status).toBe("completed_with_errors");
		expect(result.crawlRun.runIntent).toBe("baseline");
		expect(result.pageObservations).toEqual([]);

		const crawlRun = readJsonArtifact<{
			counters: { failures: number };
			status: string;
		}>(result.artifactPaths["crawl-run.json"]);
		const hostSummary = readJsonArtifact<{
			hosts: Array<{ host: string; pagesFetched: number }>;
		}>(result.artifactPaths["host-summary.json"]);
		const urlResults = readJsonlArtifact<Array<{ normalizedCanonicalUrl: string }>[number]>(
			result.artifactPaths["url-results.jsonl"],
		);
		const failures = readJsonlArtifact<Array<{ reason: string }>[number]>(
			result.artifactPaths["failures.jsonl"],
		);
		const qualityAudit = readJsonArtifact<{
			summary: { passPages: number; totalPages: number };
		}>(result.artifactPaths["quality-audit.json"]);

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

	it("fails closed when artifact upload store is not configured", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();

		await expect(
			crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_missing_artifact_store",
				controlPlaneClient: createTargetWorksetControlPlaneForTest({
					runId: "owrun_missing_artifact_store",
				}),
				crawlHosts: async () => ({
					hostSummaries: [],
					pageObservations: [],
					urlResults: [],
					failures: [],
					pages: [],
				}),
			}),
		).rejects.toThrow(/requires artifactStore unless localArtifactsOnly is true/u);
	});

	it("deduplicates repeated fetched page artifacts before building bundle and quality audit", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();
		const pageArtifact = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_duplicate_fetch",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-04-01T09:00:00.000Z",
		});

		const result = (await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_duplicate_fetch",
			localArtifactsOnly: true,
			controlPlaneClient: createTargetWorksetControlPlaneForTest({
				runId: "owrun_duplicate_fetch",
			}),
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
		})) as {
			pageObservations: Array<{ normalizedCanonicalUrl: string; rawAssetId: string | null }>;
			pages: Array<{ rawAssetId: string; rawVersionId: string }>;
			qualityAudit: { summary: { reviewPages: number; totalPages: number } };
			sourceTruthBundle: { pages: Array<{ normalizedCanonicalUrl: string }> };
		};

		expect(result.pages).toHaveLength(1);
		expect(result.pageObservations).toHaveLength(1);
		expect(result.sourceTruthBundle.pages).toHaveLength(1);
		expect(result.sourceTruthBundle.pages[0]?.normalizedCanonicalUrl).toBe(
			"https://www.example.edu/",
		);
		expect(result.qualityAudit.summary.totalPages).toBe(1);
		expect(result.qualityAudit.summary.reviewPages).toBe(1);
	});
}
