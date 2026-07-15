import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
} from "../src/core/index.ts";

import { crawlSite } from "../src/crawl";
import { buildCollectedPageArtifacts } from "../src/page-artifacts";
import { buildCollectorQcReport } from "../src/qc-report";
import {
	buildOfficialWebTargetMatchForTest,
	buildTargetWorksetCandidatesForTest,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	SAMPLE_NEWS_HOME_PAGE_HTML,
	SAMPLE_PAGE_HTML,
	writeTestConfigRoot,
} from "./crawl-test-support";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("source-collector official-web adapter qc report", () => {
	it("aggregates clean crawl outputs into a passing qc report", async () => {
		const first = await writeOutputDir({
			crawlRunId: "owrun_qc_001",
			outputDirName: "output-a",
			requestedUrl: "https://www.example.edu/admissions?id=9",
			responseBody: SAMPLE_PAGE_HTML,
			fetchedAt: "2026-03-31T09:00:00.000Z",
		});
		const second = await writeOutputDir({
			crawlRunId: "owrun_qc_002",
			outputDirName: "output-b",
			requestedUrl: "https://www.example.edu/news/",
			responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-31T09:05:00.000Z",
		});

		const report = await buildCollectorQcReport({
			outputDirs: [first.outputDir, second.outputDir],
			configRoot: first.configRoot,
		});

		expect(report.valid).toBe(true);
		expect(report.totals.outputs).toBe(2);
		expect(report.totals.bundlePages).toBe(2);
		expect(report.totals.validationErrors).toBe(0);
		expect(report.totals.failPages).toBe(0);
		expect(report.totals.unexpectedReviewPages).toBe(0);
		expect(report.outputs.map((item) => item.audit.siteId)).toEqual([
			"campus_public",
			"campus_public",
		]);
	});

	it("keeps shell-review findings within the qc gate when allowlisted", async () => {
		const shell = await writeOutputDir({
			crawlRunId: "owrun_qc_003",
			outputDirName: "output-shell",
			requestedUrl: "https://www.example.edu/library/",
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-31T09:10:00.000Z",
		});

		const report = await buildCollectorQcReport({
			outputDirs: [shell.outputDir],
			configRoot: shell.configRoot,
			allowedReviewIssueCodes: ["shell_family_requires_manual_review"],
			allowedReviewPageFamilies: ["dynamic_shell_page", "structural_shell_page"],
		});

		expect(report.valid).toBe(true);
		expect(report.totals.reviewPages).toBe(1);
		expect(report.totals.unexpectedReviewPages).toBe(0);
		expect(report.unexpectedReviewPages).toEqual([]);
	});

	it("loads site qc policy by default when configRoot is provided", async () => {
		const shell = await writeOutputDir({
			crawlRunId: "owrun_qc_003b",
			outputDirName: "output-shell-default-policy",
			requestedUrl: "https://www.example.edu/library/",
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-31T09:12:00.000Z",
			qcPolicy: {
				schema_version: "official_web_qc_policy.v1",
				site_id: "campus_public",
				qc_policy_version: "campus_public_qc_v1",
				allowed_review_issue_codes: ["shell_family_requires_manual_review"],
				allowed_review_page_families: ["dynamic_shell_page", "structural_shell_page"],
				host_overrides: [],
			},
		});

		const report = await buildCollectorQcReport({
			outputDirs: [shell.outputDir],
			configRoot: shell.configRoot,
		});

		expect(report.valid).toBe(true);
		expect(report.totals.reviewPages).toBe(1);
		expect(report.totals.unexpectedReviewPages).toBe(0);
	});

	it("fails the qc gate when review findings are not allowlisted", async () => {
		const shell = await writeOutputDir({
			crawlRunId: "owrun_qc_004",
			outputDirName: "output-shell-unexpected",
			requestedUrl: "https://www.example.edu/library/",
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-31T09:15:00.000Z",
		});

		const report = await buildCollectorQcReport({
			outputDirs: [shell.outputDir],
			configRoot: shell.configRoot,
		});

		expect(report.valid).toBe(false);
		expect(report.totals.reviewPages).toBe(1);
		expect(report.totals.unexpectedReviewPages).toBe(1);
		expect(report.unexpectedReviewPages[0]).toEqual(
			expect.objectContaining({
				outputDir: shell.outputDir,
				pageFamily: "dynamic_shell_page",
			}),
		);
	});

	it("fails the qc gate when a crawl output contains fail-level quality issues", async () => {
		const sample = await writeOutputDir({
			crawlRunId: "owrun_qc_005",
			outputDirName: "output-fail",
			requestedUrl: "https://www.example.edu/news/",
			responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-31T09:20:00.000Z",
		});

		const auditPath = resolve(sample.outputDir, "quality-audit.json");
		const auditPayload = JSON.parse(readFileSync(auditPath, "utf-8")) as {
			summary: {
				passPages: number;
				reviewPages: number;
				failPages: number;
				issueCounts: Record<string, number>;
			};
			pages: Array<{
				status: string;
				pageFamily: string;
				normalizedCanonicalUrl: string;
				issues: Array<{ code: string; severity: string; message: string }>;
			}>;
		};
		const [firstPage] = auditPayload.pages;
		if (!firstPage) {
			throw new Error("audit payload page is required");
		}
		firstPage.status = "fail";
		firstPage.issues = [
			{
				code: "listing_family_without_listing_signal",
				severity: "fail",
				message: "synthetic fail signal for qc gate coverage",
			},
		];
		auditPayload.summary.passPages = 0;
		auditPayload.summary.reviewPages = 0;
		auditPayload.summary.failPages = 1;
		auditPayload.summary.issueCounts = {
			listing_family_without_listing_signal: 1,
		};
		writeFileSync(auditPath, JSON.stringify(auditPayload, null, 2));

		const report = await buildCollectorQcReport({
			outputDirs: [sample.outputDir],
			configRoot: sample.configRoot,
		});

		expect(report.valid).toBe(false);
		expect(report.totals.failPages).toBe(1);
		expect(report.failPages).toEqual([
			expect.objectContaining({
				outputDir: sample.outputDir,
				issueCodes: ["listing_family_without_listing_signal"],
			}),
		]);
	});

	it("runs the qc-report cli through node strip-types mode", async () => {
		const shell = await writeOutputDir({
			crawlRunId: "owrun_qc_006",
			outputDirName: "output-cli",
			requestedUrl: "https://www.example.edu/library/",
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-31T09:25:00.000Z",
			qcPolicy: {
				schema_version: "official_web_qc_policy.v1",
				site_id: "campus_public",
				qc_policy_version: "campus_public_qc_v1",
				allowed_review_issue_codes: ["shell_family_requires_manual_review"],
				allowed_review_page_families: ["dynamic_shell_page", "structural_shell_page"],
				host_overrides: [],
			},
		});

		const raw = execFileSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"src/qc-report.ts",
				"--",
				"--config-root",
				shell.configRoot,
				"--output-dir",
				shell.outputDir,
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
				encoding: "utf-8",
			},
		);

		const report = JSON.parse(raw) as { valid: boolean; totals: { unexpectedReviewPages: number } };
		expect(report.valid).toBe(true);
		expect(report.totals.unexpectedReviewPages).toBe(0);
	}, 20_000);
});

async function writeOutputDir(input: {
	crawlRunId: string;
	outputDirName: string;
	requestedUrl: string;
	responseBody: string;
	fetchedAt: string;
	qcPolicy?: Record<string, unknown>;
}): Promise<{ outputDir: string; configRoot: string }> {
	const { configRoot, outputDir: baseOutputDir } = writeTestConfigRoot();
	if (input.qcPolicy) {
		writeFileSync(
			resolve(configRoot, "campus_public", "qc-policy.json"),
			JSON.stringify(input.qcPolicy, null, 2),
		);
	}
	const outputDir = resolve(baseOutputDir, input.outputDirName);
	const bundle = loadOfficialWebConfig("campus_public", { configRoot });
	const plan = buildOfficialWebCrawlPlan("campus_public", {
		configRoot,
		crawlRunId: input.crawlRunId,
	});
	const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
	if (!hostPolicy) {
		throw new Error("expected test host policy");
	}

	const pageArtifacts = buildCollectedPageArtifacts({
		bundle,
		plan,
		hostPolicy,
		requestedUrl: input.requestedUrl,
		finalUrl: input.requestedUrl,
		declaredCanonicalUrl: input.requestedUrl,
		responseBody: input.responseBody,
		responseHeaders: {
			"content-type": "text/html; charset=utf-8",
		},
		httpStatus: 200,
		contentType: "text/html",
		discoveryMethod: "seed",
		discoveredFromUrl: null,
		fetchedAt: input.fetchedAt,
		targetLineage: buildOfficialWebTargetMatchForTest(),
		html: load(input.responseBody),
	});

	await crawlSite("campus_public", {
		configRoot,
		outputDir,
		crawlRunId: input.crawlRunId,
		localArtifactsOnly: true,
		crawlCandidates: buildTargetWorksetCandidatesForTest({
			runId: input.crawlRunId,
		}),
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
					crawlRunId: input.crawlRunId,
					observedAt: input.fetchedAt,
					requestedUrl: input.requestedUrl,
					finalUrl: input.requestedUrl,
					declaredCanonicalUrl: input.requestedUrl,
					normalizedCanonicalUrl: pageArtifacts.pageManifest.normalizedCanonicalUrl,
					urlIdentityBasis: pageArtifacts.pageManifest.urlIdentityBasis,
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

	return { outputDir, configRoot };
}
