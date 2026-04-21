import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
	SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
	SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
	SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsDetailSuite() {
	it("extracts a checked-in real article detail fixture into stable article blocks", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_008",
			requestedUrl: "https://www.example.edu/news/info/1011/61784.htm",
			finalUrl: "https://www.example.edu/news/info/1011/61784.htm",
			responseBody: SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/news/zhxw.htm",
			fetchedAt: "2026-03-29T08:34:00.000Z",
		});

		expect(pageArtifacts.pageManifest.pageTitleNormalized).toBe(
			"中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
		);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
		expect(pageArtifacts.pageManifest.publishedAt).toBe("2026-03-25T00:00:00+08:00");
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "paragraph" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("重大招标系列项目开题论证会开幕式"),
			),
		).toBe(true);
	});

	it("hydrates engine2 detail richtext from inline bootstrap data and suppresses hidden audio placeholders", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_engine2_bootstrap",
			requestedUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
			finalUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
			responseBody: SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-04-01T09:00:00.000Z",
		});

		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
		expect(pageArtifacts.pageManifest.publishedAt).toBe("2026-03-18T09:44:37+08:00");
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(
			2,
		);
		expect(pageArtifacts.providerExtraction.pageSignals.mainContentCharacterCount).toBeGreaterThan(
			40,
		);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "paragraph" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("春启新篇，书香聚力"),
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) => item.isMainContent && (item.textNormalized ?? "").includes("暂无歌词"),
			),
		).toBe(false);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" &&
					item.isMainContent &&
					item.linkTarget === "https://d.cxstar.com/",
			),
		).toBe(true);
	});

	it("extracts canonical publishedAt only from detail metadata, not listing aggregates", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_listing_publish_guard",
			requestedUrl: "https://www.example.edu/history/list.htm",
			finalUrl: "https://www.example.edu/history/list.htm",
			responseBody: SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/history/",
			fetchedAt: "2026-04-02T12:21:00.000Z",
		});

		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(pageArtifacts.pageManifest.publishedAt).toBeNull();
	});

	it("keeps unrecovered engine2 detail pages thin instead of treating hidden audio placeholders as main content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_engine2_thin",
			requestedUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
			finalUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
			responseBody: SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-04-01T09:05:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBeLessThanOrEqual(2);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) => item.isMainContent && (item.textNormalized ?? "").includes("暂无歌词"),
			),
		).toBe(false);
	});
}
