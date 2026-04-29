import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	buildDirectorySiteArtifactsForTest,
	SAMPLE_HISTORY_HOME_CARD_PAGE_HTML,
	SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
	SAMPLE_NEWS_HOME_PAGE_HTML,
	SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML,
	SAMPLE_PAGE_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsListingSuite() {
	it("suppresses aggregate news-card list items and strips script residue from extracted text", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_004",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-29T08:30:00.000Z",
		});

		expect(
			pageArtifacts.contentBlocks.some((item) =>
				(item.textNormalized ?? "").includes("_showDynClickBatch"),
			),
		).toBe(false);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "list_item" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("新闻头条"),
			),
		).toBe(false);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "list_item" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("24张，集齐一整年的民大"),
			),
		).toBe(false);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "heading" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes(
						"中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
					),
			),
		).toBe(true);
	});

	it("classifies portal-style news homepages with lead teaser and repeated chrome as listing pages", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_004aa",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			responseBody: SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML,
			fetchedAt: "2026-04-02T12:20:00.000Z",
		});

		expect(
			pageArtifacts.providerExtraction.pageSignals.repeatedNonMainBlockCount,
		).toBeGreaterThanOrEqual(20);
		expect(pageArtifacts.providerExtraction.pageSignals.mainHeadingCount).toBeGreaterThanOrEqual(4);
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(
			3,
		);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	});

	it("prefers title-only link text for aggregate card anchors and normalizes split day-month date text", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_004b",
			requestedUrl: "https://www.example.edu/history/",
			finalUrl: "https://www.example.edu/history/",
			responseBody: SAMPLE_HISTORY_HOME_CARD_PAGE_HTML,
			fetchedAt: "2026-04-02T12:00:00.000Z",
		});

		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(
			pageArtifacts.contentBlocks.find(
				(item) =>
					item.blockRole === "link" &&
					item.isMainContent &&
					item.linkTarget === "https://www.example.edu/info/1001/1.htm",
			)?.textNormalized,
		).toBe("历史文化学院2025年大事记");
		expect(
			pageArtifacts.contentBlocks.find(
				(item) =>
					item.blockRole === "link" &&
					item.isMainContent &&
					item.linkTarget === "https://www.example.edu/info/1001/2.htm",
			)?.textNormalized,
		).toBe("2025-2026-1学期缓补考时间安排");
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.isMainContent &&
					item.blockRole === "link" &&
					/242026\\.03|2026-03-12/.test(item.textNormalized ?? ""),
			),
		).toBe(false);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.isMainContent &&
					item.blockRole === "paragraph" &&
					item.textNormalized === "2026-03-24",
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.filter(
				(item) =>
					item.isMainContent &&
					item.blockRole !== "link" &&
					["历史文化学院2025年大事记", "2025-2026-1学期缓补考时间安排"].includes(
						item.textNormalized ?? "",
					),
			),
		).toHaveLength(0);
	});

	it("keeps mixed aggregate card listings as listing pages after duplicate title descendants are demoted", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_004c",
			requestedUrl: "https://www.example.edu/history/mixed.htm",
			finalUrl: "https://www.example.edu/history/mixed.htm",
			responseBody: SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
			fetchedAt: "2026-04-02T12:10:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(6);
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(5);
		expect(
			pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount,
		).toBeGreaterThanOrEqual(4);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(
			pageArtifacts.contentBlocks.filter(
				(item) =>
					item.isMainContent &&
					item.blockRole !== "link" &&
					[
						"2025-2026-1学期缓补考时间安排",
						"2026年3月历史学（强基计划）动态调整结果公示",
						"我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行",
					].includes(item.textNormalized ?? ""),
			),
		).toHaveLength(0);
	});

	it("emits explicit main-content link blocks for heading anchors in content listings", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_005",
			requestedUrl: "https://www.example.edu/news/xyjw.htm",
			finalUrl: "https://www.example.edu/news/xyjw.htm",
			responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-29T08:31:00.000Z",
		});

		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" &&
					item.isMainContent &&
					item.textNormalized === "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会" &&
					item.linkTarget === "https://www.example.edu/news/info/1011/61784.htm",
			),
		).toBe(true);
	});

	it("marks repeated navigation/category candidates and compacts heading paths without null holes", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_006",
			requestedUrl: "https://www.example.edu/news/xyjw.htm",
			finalUrl: "https://www.example.edu/news/xyjw.htm",
			responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-29T08:32:00.000Z",
		});

		const repeatedCategoryBlocks = pageArtifacts.contentBlocks.filter(
			(item) => item.textNormalized === "综合新闻",
		);
		expect(repeatedCategoryBlocks.length).toBeGreaterThanOrEqual(2);
		expect(repeatedCategoryBlocks.every((item) => item.isRepeatedCandidate === true)).toBe(true);

		const articleHeading = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "heading" &&
				item.textNormalized === "教育学院与故宫博物院联合开展学雷锋纪念日主题活动",
		);

		expect(articleHeading?.parentHeadingPath).toEqual(["校园经纬"]);
	});

	it("does not leak the latest main heading context into footer boilerplate blocks", () => {
		const pageArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_007",
			requestedUrl: "https://www.example.edu/admissions?id=9",
			finalUrl: "https://www.example.edu/admissions?id=9",
			declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
			responseBody: SAMPLE_PAGE_HTML,
			fetchedAt: "2026-03-29T08:33:00.000Z",
		});

		const footerBlock = pageArtifacts.contentBlocks.find(
			(item) => item.blockRole === "footer" && item.textNormalized === "Campus public 版权所有",
		);

		expect(footerBlock?.isNavigation).toBe(true);
		expect(footerBlock?.sectionHint ?? null).toBeNull();
		expect(footerBlock?.parentHeadingPath ?? []).toEqual([]);
	});
}
