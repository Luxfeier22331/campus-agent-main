import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	loadOfficialWebConfig,
	OFFICIAL_WEB_PAGE_FAMILIES,
	OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
	type OfficialWebPageFamily,
	type OfficialWebQualityAuditDocument,
} from "./core/index.ts";
import type {
	BuildCollectorQcReportInput,
	CollectorQcReport,
	CollectorQcThresholds,
	LoadedCollectorQcConfigBundle,
	LoadedCollectorQcSitePolicy,
} from "./qc-report-types.ts";

export function readQualityAudit(outputDir: string): OfficialWebQualityAuditDocument {
	const auditPath = resolve(outputDir, OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT);
	if (!existsSync(auditPath)) {
		throw new Error(`missing quality audit: ${auditPath}`);
	}

	return JSON.parse(readFileSync(auditPath, "utf-8")) as OfficialWebQualityAuditDocument;
}

export function parseAllowedReviewFamilies(
	values: string[] | undefined,
): OfficialWebPageFamily[] | undefined {
	if (!values) {
		return;
	}

	return values.map((value) => {
		if (!OFFICIAL_WEB_PAGE_FAMILIES.includes(value as OfficialWebPageFamily)) {
			throw new Error(`unknown review family: ${value}`);
		}
		return value as OfficialWebPageFamily;
	});
}

export function isAllowedReviewPage(
	page: OfficialWebQualityAuditDocument["pages"][number],
	thresholds: CollectorQcThresholds,
): boolean {
	if (!thresholds.allowedReviewPageFamilies.includes(page.pageFamily)) {
		return false;
	}

	return (
		page.issues.length > 0 &&
		page.issues.every((item) => thresholds.allowedReviewIssueCodes.includes(item.code))
	);
}

export function loadCollectorQcSitePolicy(
	siteId: string,
	options: Pick<BuildCollectorQcReportInput, "repoRoot" | "configRoot">,
	cache: Map<string, LoadedCollectorQcSitePolicy>,
): LoadedCollectorQcSitePolicy {
	const cached = cache.get(siteId);
	if (cached) {
		return cached;
	}

	const bundle = loadOfficialWebConfig(siteId, {
		repoRoot: options.repoRoot,
		configRoot: options.configRoot,
	});
	const policy = normalizeCollectorQcSitePolicy(bundle);
	cache.set(siteId, policy);
	return policy;
}

export function resolveSiteThresholdsForPage(
	policy: LoadedCollectorQcSitePolicy,
	host: string,
): CollectorQcThresholds {
	const hostOverride = policy.hostOverrides.get(host);
	return {
		allowedReviewIssueCodes: [
			...new Set([
				...policy.allowedReviewIssueCodes,
				...(hostOverride?.allowedReviewIssueCodes ?? []),
			]),
		].sort(),
		allowedReviewPageFamilies: [
			...new Set([
				...policy.allowedReviewPageFamilies,
				...(hostOverride?.allowedReviewPageFamilies ?? []),
			]),
		].sort(),
	};
}

export function mergeQcThresholds(
	left: CollectorQcThresholds,
	right: CollectorQcThresholds,
): CollectorQcThresholds {
	return {
		allowedReviewIssueCodes: [
			...new Set([...left.allowedReviewIssueCodes, ...right.allowedReviewIssueCodes]),
		].sort(),
		allowedReviewPageFamilies: [
			...new Set([...left.allowedReviewPageFamilies, ...right.allowedReviewPageFamilies]),
		].sort(),
	};
}

export function createEmptyFamilyCounts(): CollectorQcReport["familyCounts"] {
	return OFFICIAL_WEB_PAGE_FAMILIES.reduce<Record<OfficialWebPageFamily, number>>(
		(result, family) => {
			result[family] = 0;
			return result;
		},
		{} as Record<OfficialWebPageFamily, number>,
	);
}

function normalizeCollectorQcSitePolicy(
	bundle: LoadedCollectorQcConfigBundle,
): LoadedCollectorQcSitePolicy {
	return {
		siteId: bundle.site.siteId,
		allowedReviewIssueCodes: [...bundle.qcPolicy.allowedReviewIssueCodes].sort(),
		allowedReviewPageFamilies: [...bundle.qcPolicy.allowedReviewPageFamilies].sort(),
		hostOverrides: new Map(
			bundle.qcPolicy.hostOverrides.map((override) => [
				override.host,
				{
					allowedReviewIssueCodes: [...override.allowedReviewIssueCodes].sort(),
					allowedReviewPageFamilies: [...override.allowedReviewPageFamilies].sort(),
				},
			]),
		),
	};
}
