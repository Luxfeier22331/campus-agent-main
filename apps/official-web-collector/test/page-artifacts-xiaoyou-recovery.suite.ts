import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML,
	SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML,
	SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
	SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML,
	SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
	SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
	SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML,
	SAMPLE_XIAOYOU_HOME_PAGE_HTML,
	SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML,
	SAMPLE_XIAOYOU_LIST_PAGE_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsXiaoyouRecoverySuite() {
	it("classifies dense direct roster pages on content sites as directory pages instead of generic listing pages", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012h_dense",
			requestedUrl: "https://www.example.edu/szdw1.htm",
			finalUrl: "https://www.example.edu/szdw1.htm",
			responseBody: SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML,
			fetchedAt: "2026-04-02T12:16:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(12);
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
		expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBe(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
	});

	it("demotes xiaoyou-style fixed sidebar contact widgets out of main content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013",
			requestedUrl: "https://www.example.edu/alumni.htm",
			finalUrl: "https://www.example.edu/alumni.htm",
			responseBody: SAMPLE_XIAOYOU_HOME_PAGE_HTML,
			fetchedAt: "2026-03-29T09:00:00.000Z",
		});

		const leakedSidebarBlocks = pageArtifacts.contentBlocks.filter(
			(item) =>
				item.isMainContent &&
				((item.textNormalized ?? "").includes("010-68932500") ||
					(item.textNormalized ?? "").includes("2013027@muc.edu.cn")),
		);

		expect(leakedSidebarBlocks).toHaveLength(0);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "list_item" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("全国两会上民大人声音"),
			),
		).toBe(true);
	});

	it("prefers fuller anchor title text, suppresses dated child-link duplicates, and does not infer missing prefixes on xiaoyou home sections", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013a",
			requestedUrl: "https://www.example.edu/alumni-live.htm",
			finalUrl: "https://www.example.edu/alumni-live.htm",
			responseBody: SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML,
			fetchedAt: "2026-04-01T08:00:00.000Z",
		});

		const xiaoyouSectionItems = pageArtifacts.contentBlocks
			.filter(
				(item) =>
					item.blockRole === "list_item" &&
					item.isMainContent &&
					(item.parentHeadingPath ?? []).at(-1) === "校友会动态",
			)
			.map((item) => item.textNormalized);
		const foundationItem = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "list_item" &&
				item.isMainContent &&
				(item.parentHeadingPath ?? []).at(-1) === "基金会动态",
		);
		const duplicatedMainLinks = pageArtifacts.contentBlocks.filter(
			(item) =>
				item.blockRole === "link" &&
				item.isMainContent &&
				[
					"https://mp.weixin.qq.com/s/kHOaEpryJ9oy_A6NXNAhGw",
					"https://mp.weixin.qq.com/s/xtybxO4eKRzImzIreOLSRg",
					"https://mp.weixin.qq.com/s/6ZpX2byjb5j8UJ5XYiR5OA",
					"https://mp.weixin.qq.com/s/7ZwKk37lvAnOGJcU89j2dg",
					"https://mp.weixin.qq.com/s/nkWA_2jlmS-e9yTfbEfmyw",
				].includes(item.linkTarget ?? ""),
		);
		const recoveredAnchorText = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "link" &&
				item.linkTarget === "https://mp.weixin.qq.com/s/xtybxO4eKRzImzIreOLSRg",
		);
		const acceptedLeadingNameItem = xiaoyouSectionItems.find((item) =>
			(item ?? "").includes("优秀履职奖"),
		);

		expect(xiaoyouSectionItems).toEqual([
			"全国两会上民大人声音 2026-03-20",
			"全国政协委员们发延：让民族团结之花在中华大地常开长盛 2026-03-20",
			"们发延校友荣获2025年度“全国政协委员优秀履职奖” 2026-03-09",
			"“溪州铜柱”背后的故事：湖南校友会这样讲铸牢中华民族共同体 2026-03-09",
		]);
		expect(foundationItem?.textNormalized).toBe(
			"奖教励学 法育英才 | 京师律师教育基金奖教（学）金典礼顺利举行 2025-12-29",
		);
		expect(duplicatedMainLinks).toHaveLength(0);
		expect(acceptedLeadingNameItem).toBe(
			"们发延校友荣获2025年度“全国政协委员优秀履职奖” 2026-03-09",
		);
		expect(recoveredAnchorText?.textNormalized).toBe(
			"全国政协委员们发延：让民族团结之花在中华大地常开长盛",
		);
	});

	it("does not treat javascript pseudo-links like 手机版 as main content on shell pages", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013b",
			requestedUrl: "https://www.example.edu/kxyj.htm",
			finalUrl: "https://www.example.edu/kxyj.htm",
			responseBody: SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-30T12:18:00.000Z",
		});

		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" && item.textNormalized === "手机版" && item.isMainContent,
			),
		).toBe(false);
		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
	}, 15_000);

	it("classifies single-entry dated link lists as listing pages instead of generic content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013c",
			requestedUrl: "https://www.example.edu/jyjx/ssspy.htm",
			finalUrl: "https://www.example.edu/jyjx/ssspy.htm",
			responseBody: SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML,
			fetchedAt: "2026-03-30T12:22:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainListItemCount).toBeGreaterThanOrEqual(
			1,
		);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(1);
		expect(
			pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount,
		).toBeGreaterThanOrEqual(1);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	});

	it("treats onclick-driven news cards as main-content listing links", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013d",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			responseBody: SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
			fetchedAt: "2026-03-31T10:00:00.000Z",
		});

		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(2);
		expect(
			pageArtifacts.discoveredLinks.some(
				(item) => item.normalizedUrl === "https://www.example.edu/info/1040/6035.htm",
			),
		).toBe(true);
	});

	it("recovers div-based visible content instead of classifying the page as a dynamic shell", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013e",
			requestedUrl: "https://www.example.edu/rcpy.htm",
			finalUrl: "https://www.example.edu/rcpy.htm",
			responseBody: SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
			fetchedAt: "2026-03-31T16:00:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(
			2,
		);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
	}, 15_000);

	it("recovers panel-style card listings instead of classifying the page as a dynamic shell", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013f",
			requestedUrl: "https://www.example.edu/sport/index.htm",
			finalUrl: "https://www.example.edu/sport/index.htm",
			responseBody: SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML,
			fetchedAt: "2026-03-31T16:01:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	});

	it("recovers sport-homepage card clusters into listing signals instead of leaving the page as a shell", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_013g",
			requestedUrl: "https://www.example.edu/sport/",
			finalUrl: "https://www.example.edu/sport/",
			responseBody: SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
			fetchedAt: "2026-03-31T17:20:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
		expect(
			pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount,
		).toBeGreaterThanOrEqual(3);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	});

	it("extracts xiaoyou-style listing tables via content links instead of a giant main-content table", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_014",
			requestedUrl: "https://www.example.edu/xwdt/xyhdt.htm",
			finalUrl: "https://www.example.edu/xwdt/xyhdt.htm",
			responseBody: SAMPLE_XIAOYOU_LIST_PAGE_HTML,
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/xwdt.htm",
			fetchedAt: "2026-03-29T09:01:00.000Z",
		});

		const tableBlock = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "table" &&
				(item.textNormalized ?? "").includes("全国两会上民大人声音") &&
				(item.textNormalized ?? "").includes("2026年03月20日"),
		);
		const contentLink = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "link" &&
				item.isMainContent &&
				item.linkTarget === "https://mp.weixin.qq.com/s/kHOaEpryJ9oy_A6NXNAhGw",
		);
		const leakedSidebarBlocks = pageArtifacts.contentBlocks.filter(
			(item) => item.isMainContent && (item.textNormalized ?? "").includes("010-68932500"),
		);

		expect(tableBlock?.isMainContent).toBe(false);
		expect(contentLink?.textNormalized).toBe("全国两会上民大人声音");
		expect(leakedSidebarBlocks).toHaveLength(0);
	});
}
