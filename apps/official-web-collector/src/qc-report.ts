import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { normalizeCliArgs } from "./cli.ts";
import { OFFICIAL_WEB_PAGE_FAMILIES } from "./official-web-core.ts";
import { printQcReport } from "./qc-report-render.ts";
import {
	createEmptyFamilyCounts,
	isAllowedReviewPage,
	loadCollectorQcSitePolicy,
	mergeQcThresholds,
	parseAllowedReviewFamilies,
	readQualityAudit,
	resolveSiteThresholdsForPage,
} from "./qc-report-thresholds.ts";
import type {
	BuildCollectorQcReportInput,
	CollectorQcOutputReport,
	CollectorQcPageFinding,
	CollectorQcReport,
	CollectorQcThresholds,
	LoadedCollectorQcSitePolicy,
} from "./qc-report-types.ts";
import { validateCollectorOutput } from "./validate.ts";

export type {
	BuildCollectorQcReportInput,
	CollectorQcOutputReport,
	CollectorQcPageFinding,
	CollectorQcReport,
} from "./qc-report-types.ts";

export async function buildCollectorQcReport(
	input: BuildCollectorQcReportInput,
): Promise<CollectorQcReport> {
	if (input.outputDirs.length === 0) {
		throw new Error("at least one output dir is required");
	}

	const cliThresholds = {
		allowedReviewIssueCodes: [...new Set(input.allowedReviewIssueCodes ?? [])].sort(),
		allowedReviewPageFamilies: [...new Set(input.allowedReviewPageFamilies ?? [])].sort(),
	} satisfies CollectorQcThresholds;
	const resolvedIssueCodes = new Set(cliThresholds.allowedReviewIssueCodes);
	const resolvedPageFamilies = new Set(cliThresholds.allowedReviewPageFamilies);
	const sitePolicies = new Map<string, LoadedCollectorQcSitePolicy>();

	const outputs: CollectorQcOutputReport[] = [];
	const unexpectedReviewPages: CollectorQcPageFinding[] = [];
	const failPages: CollectorQcPageFinding[] = [];
	const familyCounts = createEmptyFamilyCounts();
	const issueCounts: Record<string, number> = {};
	const targetFamilyCounts: Record<string, number> = {};
	const retentionDecisionCounts: Record<string, number> = {};
	let bundlePages = 0;
	let validationErrors = 0;
	let validationWarnings = 0;
	let passPages = 0;
	let reviewPages = 0;
	let failPageCount = 0;

	for (const outputDir of input.outputDirs) {
		const validation = await validateCollectorOutput(outputDir);
		const audit = readQualityAudit(outputDir);
		const sitePolicy = loadCollectorQcSitePolicy(audit.siteId, input, sitePolicies);

		for (const code of sitePolicy.allowedReviewIssueCodes) {
			resolvedIssueCodes.add(code);
		}
		for (const family of sitePolicy.allowedReviewPageFamilies) {
			resolvedPageFamilies.add(family);
		}
		for (const override of sitePolicy.hostOverrides.values()) {
			for (const code of override.allowedReviewIssueCodes) {
				resolvedIssueCodes.add(code);
			}
			for (const family of override.allowedReviewPageFamilies) {
				resolvedPageFamilies.add(family);
			}
		}

		outputs.push({
			outputDir,
			validation,
			audit: {
				siteId: audit.siteId,
				crawlRunId: audit.crawlRunId,
				totalPages: audit.summary.totalPages,
				passPages: audit.summary.passPages,
				reviewPages: audit.summary.reviewPages,
				failPages: audit.summary.failPages,
				familyCounts: audit.summary.familyCounts,
				issueCounts: audit.summary.issueCounts,
				targetFamilyCounts: audit.summary.targetFamilyCounts ?? {},
				retentionDecisionCounts: audit.summary.retentionDecisionCounts ?? {},
			},
		});

		bundlePages += validation.counts.bundlePages;
		validationErrors += validation.counts.errors;
		validationWarnings += validation.counts.warnings;
		passPages += audit.summary.passPages;
		reviewPages += audit.summary.reviewPages;
		failPageCount += audit.summary.failPages;

		for (const family of OFFICIAL_WEB_PAGE_FAMILIES) {
			familyCounts[family] += audit.summary.familyCounts[family] ?? 0;
		}

		for (const [code, count] of Object.entries(audit.summary.issueCounts)) {
			issueCounts[code] = (issueCounts[code] ?? 0) + count;
		}
		for (const [family, count] of Object.entries(audit.summary.targetFamilyCounts ?? {})) {
			targetFamilyCounts[family] = (targetFamilyCounts[family] ?? 0) + count;
		}
		for (const [decision, count] of Object.entries(audit.summary.retentionDecisionCounts ?? {})) {
			retentionDecisionCounts[decision] = (retentionDecisionCounts[decision] ?? 0) + count;
		}

		for (const page of audit.pages) {
			if (page.status === "fail") {
				failPages.push({
					outputDir,
					siteId: audit.siteId,
					crawlRunId: audit.crawlRunId,
					normalizedCanonicalUrl: page.normalizedCanonicalUrl,
					pageFamily: page.pageFamily,
					issueCodes: page.issues.map((item) => item.code),
				});
				continue;
			}

			if (page.status !== "review") {
				continue;
			}

			if (
				isAllowedReviewPage(
					page,
					mergeQcThresholds(cliThresholds, resolveSiteThresholdsForPage(sitePolicy, page.host)),
				)
			) {
				continue;
			}

			unexpectedReviewPages.push({
				outputDir,
				siteId: audit.siteId,
				crawlRunId: audit.crawlRunId,
				normalizedCanonicalUrl: page.normalizedCanonicalUrl,
				pageFamily: page.pageFamily,
				issueCodes: page.issues.map((item) => item.code),
			});
		}
	}

	const thresholds = {
		allowedReviewIssueCodes: [...resolvedIssueCodes].sort(),
		allowedReviewPageFamilies: [...resolvedPageFamilies].sort(),
	} satisfies CollectorQcThresholds;

	return {
		valid: validationErrors === 0 && failPages.length === 0 && unexpectedReviewPages.length === 0,
		thresholds,
		totals: {
			outputs: outputs.length,
			bundlePages,
			validationErrors,
			validationWarnings,
			passPages,
			reviewPages,
			failPages: failPageCount,
			unexpectedReviewPages: unexpectedReviewPages.length,
		},
		familyCounts,
		issueCounts,
		targetFamilyCounts,
		retentionDecisionCounts,
		outputs,
		unexpectedReviewPages,
		failPages,
	};
}

export async function qcReportMain(argv: string[] = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"repo-root": { type: "string" },
			"config-root": { type: "string" },
			"output-dir": { type: "string", multiple: true },
			"allow-review-code": { type: "string", multiple: true },
			"allow-review-family": { type: "string", multiple: true },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const outputDirs = values["output-dir"];
	if (!outputDirs || outputDirs.length === 0) {
		throw new Error("at least one --output-dir is required");
	}

	const report = await buildCollectorQcReport({
		outputDirs,
		repoRoot: values["repo-root"],
		configRoot: values["config-root"],
		allowedReviewIssueCodes: values["allow-review-code"],
		allowedReviewPageFamilies: parseAllowedReviewFamilies(values["allow-review-family"]),
	});

	if (values.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printQcReport(report);
	}

	if (!report.valid) {
		process.exitCode = 1;
	}
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	void qcReportMain();
}
