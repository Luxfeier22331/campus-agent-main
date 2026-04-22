import { readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "cheerio";

import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
} from "official-web-core";
import { describe, expect, it } from "vitest";

import * as collector from "../src/index";
import * as pageArtifactsModule from "../src/page-artifacts";
import { SAMPLE_PAGE_HTML, writeTestConfigRoot } from "./test-support";

describe("official-web-collector validate", () => {
	it("validates a complete local output directory", async () => {
		const crawlSite = (
			collector as unknown as {
				crawlSite?: typeof collector.crawlSite;
			}
		).crawlSite;
		const validateCollectorOutput = (
			collector as unknown as {
				validateCollectorOutput?: typeof collector.validateCollectorOutput;
			}
		).validateCollectorOutput;
		const buildCollectedPageArtifacts = (
			pageArtifactsModule as unknown as {
				buildCollectedPageArtifacts?: typeof pageArtifactsModule.buildCollectedPageArtifacts;
			}
		).buildCollectedPageArtifacts;

		expect(crawlSite).toBeTypeOf("function");
		expect(validateCollectorOutput).toBeTypeOf("function");
		expect(buildCollectedPageArtifacts).toBeTypeOf("function");
		if (!crawlSite || !validateCollectorOutput || !buildCollectedPageArtifacts) {
			return;
		}

		const { configRoot, outputDir } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_validate_001",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
		expect(hostPolicy).not.toBeNull();
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
			fetchedAt: "2026-03-29T09:00:00.000Z",
			html: load(SAMPLE_PAGE_HTML),
		});

		await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_validate_001",
			crawlHosts: async () => ({
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
				urlResults: [
					{
						schemaVersion: "official_web_url_result.v1",
						siteId: "campus_public",
						crawlRunId: "owrun_validate_001",
						observedAt: "2026-03-29T09:00:00.000Z",
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
			}),
		});

		const report = await validateCollectorOutput(outputDir);
		expect(report.valid).toBe(true);
		expect(report.issues).toHaveLength(0);
		expect(report.counts.warnings).toBe(0);
	});

	it("reports missing or inconsistent page artifacts", async () => {
		const crawlSite = (
			collector as unknown as {
				crawlSite?: typeof collector.crawlSite;
			}
		).crawlSite;
		const validateCollectorOutput = (
			collector as unknown as {
				validateCollectorOutput?: typeof collector.validateCollectorOutput;
			}
		).validateCollectorOutput;
		const buildCollectedPageArtifacts = (
			pageArtifactsModule as unknown as {
				buildCollectedPageArtifacts?: typeof pageArtifactsModule.buildCollectedPageArtifacts;
			}
		).buildCollectedPageArtifacts;

		expect(crawlSite).toBeTypeOf("function");
		expect(validateCollectorOutput).toBeTypeOf("function");
		expect(buildCollectedPageArtifacts).toBeTypeOf("function");
		if (!crawlSite || !validateCollectorOutput || !buildCollectedPageArtifacts) {
			return;
		}

		const { configRoot, outputDir } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_validate_002",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
		expect(hostPolicy).not.toBeNull();
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
			fetchedAt: "2026-03-29T09:05:00.000Z",
			html: load(SAMPLE_PAGE_HTML),
		});

		await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_validate_002",
			crawlHosts: async () => ({
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
				urlResults: [
					{
						schemaVersion: "official_web_url_result.v1",
						siteId: "campus_public",
						crawlRunId: "owrun_validate_002",
						observedAt: "2026-03-29T09:05:00.000Z",
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
			}),
		});

		const bundlePath = resolve(outputDir, "source-truth-bundle.json");
		const bundlePayload = JSON.parse(readFileSync(bundlePath, "utf-8")) as {
			pages: Array<{ contentBlocksObjectKey: string }>;
		};
		const contentBlocksPath = resolve(
			outputDir,
			"source-assets",
			pageArtifacts.rawAssetId,
			pageArtifacts.rawVersionId,
			"source-truth",
			"content-blocks.jsonl",
		);
		unlinkSync(contentBlocksPath);
		const [firstBundlePage] = bundlePayload.pages;
		if (!firstBundlePage) {
			throw new Error("bundle payload page is required");
		}
		firstBundlePage.contentBlocksObjectKey = "official_web/bad/object-key.jsonl";
		writeFileSync(bundlePath, JSON.stringify(bundlePayload, null, 2));

		const report = await validateCollectorOutput(outputDir);
		expect(report.valid).toBe(false);
		expect(report.issues.some((item) => item.code === "missing_page_file")).toBe(true);
		expect(report.issues.some((item) => item.code === "bundle_object_key_mismatch")).toBe(true);

		rmSync(outputDir, { recursive: true, force: true });
	});

	it("surfaces quality-audit review findings as warnings without failing correctness validation", async () => {
		const crawlSite = (
			collector as unknown as {
				crawlSite?: typeof collector.crawlSite;
			}
		).crawlSite;
		const validateCollectorOutput = (
			collector as unknown as {
				validateCollectorOutput?: typeof collector.validateCollectorOutput;
			}
		).validateCollectorOutput;
		const buildCollectedPageArtifacts = (
			pageArtifactsModule as unknown as {
				buildCollectedPageArtifacts?: typeof pageArtifactsModule.buildCollectedPageArtifacts;
			}
		).buildCollectedPageArtifacts;

		expect(crawlSite).toBeTypeOf("function");
		expect(validateCollectorOutput).toBeTypeOf("function");
		expect(buildCollectedPageArtifacts).toBeTypeOf("function");
		if (!crawlSite || !validateCollectorOutput || !buildCollectedPageArtifacts) {
			return;
		}

		const { configRoot, outputDir } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_validate_003",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
		expect(hostPolicy).not.toBeNull();
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
			fetchedAt: "2026-03-29T09:10:00.000Z",
			html: load(SAMPLE_PAGE_HTML),
		});

		await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_validate_003",
			crawlHosts: async () => ({
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
				urlResults: [
					{
						schemaVersion: "official_web_url_result.v1",
						siteId: "campus_public",
						crawlRunId: "owrun_validate_003",
						observedAt: "2026-03-29T09:10:00.000Z",
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
			}),
		});

		const auditPath = resolve(outputDir, "quality-audit.json");
		const auditPayload = JSON.parse(readFileSync(auditPath, "utf-8")) as {
			summary: {
				totalPages: number;
				passPages: number;
				reviewPages: number;
				failPages: number;
				issueCounts: Record<string, number>;
			};
			pages: Array<{
				status: string;
				issues: Array<{ code: string; severity: string; message: string }>;
			}>;
		};
		const [firstAuditPage] = auditPayload.pages;
		if (!firstAuditPage) {
			throw new Error("audit payload page is required");
		}
		firstAuditPage.status = "review";
		firstAuditPage.issues = [
			{
				code: "manual_review_signal",
				severity: "review",
				message: "synthetic review signal for validator coverage",
			},
		];
		auditPayload.summary.passPages = 0;
		auditPayload.summary.reviewPages = 1;
		auditPayload.summary.failPages = 0;
		auditPayload.summary.issueCounts = {
			manual_review_signal: 1,
		};
		writeFileSync(auditPath, JSON.stringify(auditPayload, null, 2));

		const report = await validateCollectorOutput(outputDir);
		expect(report.valid).toBe(true);
		expect(report.counts.errors).toBe(0);
		expect(report.counts.warnings).toBe(1);
		expect(report.issues.some((item) => item.code === "quality_gate_review")).toBe(true);
	});
});
