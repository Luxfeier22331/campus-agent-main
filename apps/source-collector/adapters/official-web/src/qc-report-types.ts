import type { OfficialWebConfigBundle, OfficialWebPageFamily } from "./core/index.ts";
import type { CollectorValidationReport } from "./validate.ts";

export interface BuildCollectorQcReportInput {
	outputDirs: string[];
	repoRoot?: string;
	configRoot?: string;
	allowedReviewIssueCodes?: string[];
	allowedReviewPageFamilies?: OfficialWebPageFamily[];
}

export interface CollectorQcPageFinding {
	outputDir: string;
	siteId: string;
	crawlRunId: string;
	normalizedCanonicalUrl: string;
	pageFamily: OfficialWebPageFamily;
	issueCodes: string[];
}

export interface CollectorQcOutputReport {
	outputDir: string;
	validation: CollectorValidationReport;
	audit: {
		siteId: string;
		crawlRunId: string;
		totalPages: number;
		passPages: number;
		reviewPages: number;
		failPages: number;
		familyCounts: Record<OfficialWebPageFamily, number>;
		issueCounts: Record<string, number>;
		targetFamilyCounts: Record<string, number>;
		retentionDecisionCounts: Record<string, number>;
	};
}

export interface CollectorQcReport {
	valid: boolean;
	thresholds: {
		allowedReviewIssueCodes: string[];
		allowedReviewPageFamilies: OfficialWebPageFamily[];
	};
	totals: {
		outputs: number;
		bundlePages: number;
		validationErrors: number;
		validationWarnings: number;
		passPages: number;
		reviewPages: number;
		failPages: number;
		unexpectedReviewPages: number;
	};
	familyCounts: Record<OfficialWebPageFamily, number>;
	issueCounts: Record<string, number>;
	targetFamilyCounts: Record<string, number>;
	retentionDecisionCounts: Record<string, number>;
	outputs: CollectorQcOutputReport[];
	unexpectedReviewPages: CollectorQcPageFinding[];
	failPages: CollectorQcPageFinding[];
}

export interface CollectorQcThresholds {
	allowedReviewIssueCodes: string[];
	allowedReviewPageFamilies: OfficialWebPageFamily[];
}

export interface LoadedCollectorQcSitePolicy {
	siteId: string;
	allowedReviewIssueCodes: string[];
	allowedReviewPageFamilies: OfficialWebPageFamily[];
	hostOverrides: Map<
		string,
		{
			allowedReviewIssueCodes: string[];
			allowedReviewPageFamilies: OfficialWebPageFamily[];
		}
	>;
}

export type LoadedCollectorQcConfigBundle = OfficialWebConfigBundle;
