import {
	buildOfficialWebQualityAuditDocument,
	type OfficialWebPageQualityAuditEntry,
	type OfficialWebPageQualityAuditIssue,
	type OfficialWebQualityAuditDocument,
	type OfficialWebQualityAuditStatus,
} from "./official-web-core.ts";

import type { CollectedPageArtifact } from "./page-artifacts.ts";

export function buildCollectorQualityAudit(input: {
	siteId: string;
	crawlRunId: string;
	pages: CollectedPageArtifact[];
}): OfficialWebQualityAuditDocument {
	return buildOfficialWebQualityAuditDocument({
		siteId: input.siteId,
		crawlRunId: input.crawlRunId,
		pages: input.pages.map((page) => buildPageAuditEntry(page)),
	});
}

function buildPageAuditEntry(page: CollectedPageArtifact): OfficialWebPageQualityAuditEntry {
	const signals = page.providerExtraction.pageSignals;
	const issues: OfficialWebPageQualityAuditIssue[] = [];
	const normalizedCanonicalUrl = page.pageManifest.normalizedCanonicalUrl;
	const mainContentTexts = page.contentBlocks
		.filter((item) => item.isMainContent)
		.map((item) => normalizeAuditText(item.textNormalized))
		.filter((item): item is string => item != null);

	if (
		signals.zeroMainContent &&
		page.pageManifest.pageFamily !== "dynamic_shell_page" &&
		page.pageManifest.pageFamily !== "structural_shell_page"
	) {
		issues.push({
			code: "zero_main_content_non_shell",
			severity: "review",
			message: "page has no main-content blocks but is not classified as a dynamic shell page",
		});
	}

	if (
		page.pageManifest.pageFamily === "dynamic_shell_page" ||
		page.pageManifest.pageFamily === "structural_shell_page"
	) {
		issues.push({
			code: "shell_family_requires_manual_review",
			severity: "review",
			message:
				"shell-page classifications require manual review because visible content may still be missed by static extraction",
		});
	}

	if (
		page.pageManifest.pageFamily === "listing_page" &&
		signals.mainLinkCount === 0 &&
		signals.listingTableCount === 0
	) {
		issues.push({
			code: "listing_family_without_listing_signal",
			severity: "fail",
			message: "listing_page classification lacks dense link or listing-table support",
		});
	}

	if (page.pageManifest.pageFamily === "sitemap_navigation_page" && signals.mainLinkCount < 4) {
		issues.push({
			code: "sitemap_family_without_dense_links",
			severity: "fail",
			message: "sitemap_navigation_page classification lacks dense main-content links",
		});
	}

	if (page.pageManifest.pageFamily === "gallery_page" && signals.galleryTableCount === 0) {
		issues.push({
			code: "gallery_family_without_gallery_signal",
			severity: "fail",
			message: "gallery_page classification lacks gallery-table support",
		});
	}

	if (page.pageManifest.pageFamily === "data_table_page" && signals.mainTableCount === 0) {
		issues.push({
			code: "data_table_family_without_table_signal",
			severity: "fail",
			message: "data_table_page classification lacks main table blocks",
		});
	}

	if (
		page.pageManifest.pageFamily === "generic_content_page" &&
		signals.mainTableCount > 0 &&
		signals.listingTableCount === 0 &&
		signals.galleryTableCount === 0
	) {
		issues.push({
			code: "generic_family_with_data_table_signal",
			severity: "review",
			message:
				"generic_content_page still carries main data tables and may need a more specific family",
		});
	}

	if (
		page.pageManifest.pageFamily === "generic_content_page" &&
		signals.mainContentCharacterCount <= 24 &&
		signals.repeatedNonMainBlockCount >= 40
	) {
		issues.push({
			code: "generic_family_with_thin_main_content",
			severity: "review",
			message:
				"generic_content_page has very thin main content compared with repeated non-main blocks",
		});
	}

	if (
		page.pageManifest.pageFamily === "generic_content_page" &&
		signals.contactLikeMainBlockCount >= 2 &&
		signals.mainContentBlockCount <= 5
	) {
		issues.push({
			code: "generic_family_with_contact_signal",
			severity: "review",
			message:
				"generic_content_page is contact-heavy and may need directory/contact classification",
		});
	}

	if (
		page.pageManifest.pageFamily === "article_detail" &&
		signals.mainParagraphCount < 2 &&
		signals.mainContentCharacterCount < 120
	) {
		issues.push({
			code: "article_detail_with_thin_body",
			severity: "review",
			message: "article_detail classification has a thin main-content body and should be reviewed",
		});
	}

	if (
		isEngine2DetailLikeCanonicalUrl(normalizedCanonicalUrl) &&
		signals.mainParagraphCount < 2 &&
		(signals.mainContentCharacterCount < 120 || signals.mainContentBlockCount <= 2)
	) {
		issues.push({
			code: "detail_like_page_with_thin_body",
			severity: "review",
			message:
				"detail-like page has a thin recovered body and should be reviewed for incomplete extraction",
		});
	}

	if (mainContentTexts.some((item) => isPlaceholderMainContentText(item))) {
		issues.push({
			code: "placeholder_main_content_detected",
			severity: "review",
			message: "main content contains placeholder or media-overlay text and should be reviewed",
		});
	}

	const status = resolveAuditStatus(issues);
	return {
		rawAssetId: page.rawAssetId,
		rawVersionId: page.rawVersionId,
		host: page.pageManifest.host,
		normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
		pageTitleNormalized: page.pageManifest.pageTitleNormalized,
		pageFamily: page.pageManifest.pageFamily,
		pageFamilyConfidence: page.pageManifest.pageFamilyConfidence,
		pageFamilyReason: page.pageManifest.pageFamilyReason,
		counts: {
			blockCount: page.pageManifest.blockCount,
			mainContentBlockCount: page.pageManifest.mainContentBlockCount,
			navigationBlockCount: page.pageManifest.navigationBlockCount,
			boilerplateBlockCount: page.pageManifest.boilerplateBlockCount,
			discoveredLinkCount: page.providerExtraction.extractionSummary.discoveredLinkCount,
		},
		signals,
		status,
		issues,
	};
}

function resolveAuditStatus(
	issues: OfficialWebPageQualityAuditIssue[],
): OfficialWebQualityAuditStatus {
	if (issues.some((item) => item.severity === "fail")) {
		return "fail";
	}
	if (issues.length > 0) {
		return "review";
	}
	return "pass";
}

function isEngine2DetailLikeCanonicalUrl(value: string): boolean {
	return /^https?:\/\/[^/]+\/engine2\/d\/[^/]+\/[^/]+\/[^/?#]+(?:\?|#|$)/i.test(value);
}

function isPlaceholderMainContentText(value: string): boolean {
	return /(暂无歌词|暂无数据|暂无内容|敬请期待|加载中|内容加载异常|请确认您当前网络是否连通互联网)/i.test(
		value,
	);
}

function normalizeAuditText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().replace(/\s+/g, " ");
	return normalized.length > 0 ? normalized : null;
}
