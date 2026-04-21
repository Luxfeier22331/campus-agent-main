import { existsSync, readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
	createCollectedPageArtifactForTest,
	getCrawlSite,
	SAMPLE_PAGE_HTML,
	writeTestConfigRoot,
} from "./crawl-test-support";

export function registerCrawlControlPlaneSuite() {
	it("uploads page artifacts and reports run lifecycle through the control plane", async () => {
		const crawlSite = getCrawlSite();
		const { configRoot, outputDir } = writeTestConfigRoot();
		const uploads: Array<{ objectKey: string; contentType: string; recordCount?: number }> = [];
		const lifecycle = {
			resolvedPlan: null as Record<string, unknown> | null,
			started: null as Record<string, unknown> | null,
			heartbeats: [] as Array<Record<string, unknown>>,
			finalized: null as Record<string, unknown> | null,
		};

		const pageArtifacts = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_01JQTEST",
			requestedUrl: "https://www.example.edu/admissions?id=9",
			finalUrl: "https://www.example.edu/admissions?id=9",
			declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
			responseBody: SAMPLE_PAGE_HTML,
			fetchedAt: "2026-03-29T08:00:00.000Z",
		});

		const result = (await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_local_seed",
			schedulerRunKey: "cron-2026-03-29T08:00:00Z",
			runIntent: "hot",
			artifactStore: {
				async putObject(input: {
					objectKey: string;
					data: Uint8Array;
					contentType: string;
					recordCount?: number;
				}) {
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
				async startRun(input: Record<string, unknown>) {
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
				async resolvePlan(input: Record<string, unknown>) {
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
				async sendHeartbeat(input: Record<string, unknown>) {
					lifecycle.heartbeats.push(input);
					return {
						run: {
							runId: "owrun_01JQTEST",
							status: "running",
						},
					};
				},
				async finalizeRun(input: Record<string, unknown>) {
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
			crawlHosts: async ({
				dynamicPlan,
				reportProgress,
			}: {
				dynamicPlan: { duePages: Array<{ normalizedCanonicalUrl: string }> };
				reportProgress?: (counts: {
					urlsDiscovered: number;
					urlsFetched: number;
					pagesNormalized: number;
					artifactUploads: number;
					failures: number;
				}) => Promise<void>;
			}) => {
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
		})) as {
			artifactPaths: Record<string, string>;
			crawlRun: { crawlRunId: string; runIntent: string; status: string };
			pageObservations: Array<{ normalizedCanonicalUrl: string; runIntent: string }>;
			uploadedArtifacts: Array<{ artifactType: string; objectKey: string }>;
		};

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
			lifecycle.finalized &&
				Array.isArray((lifecycle.finalized as { artifacts?: unknown[] }).artifacts)
				? (
						(lifecycle.finalized as { artifacts: Array<{ artifactType: string }> }).artifacts ?? []
					).some((item) => item.artifactType === "source_truth_bundle")
				: false,
		).toBe(true);
		expect(
			lifecycle.finalized &&
				Array.isArray((lifecycle.finalized as { pageObservations?: unknown[] }).pageObservations)
				? (
						(lifecycle.finalized as { pageObservations: Array<{ normalizedCanonicalUrl: string }> })
							.pageObservations ?? []
					).some(
						(item) => item.normalizedCanonicalUrl === "https://www.example.edu/admissions?id=9",
					)
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
		expect(readFileSync(result.artifactPaths["source-truth-bundle.json"], "utf-8")).toContain(
			'"schemaVersion": "official_web_source_truth_bundle.v1"',
		);
		expect(readFileSync(result.artifactPaths["quality-audit.json"], "utf-8")).toContain(
			'"schemaVersion": "official_web_quality_audit.v1"',
		);
		expect(readFileSync(result.artifactPaths["page-observations.jsonl"], "utf-8")).toContain(
			'"schemaVersion":"official_web_page_observation.v1"',
		);
	});
}
