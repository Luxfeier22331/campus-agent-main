import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	buildPageArtifactsForTest,
	SAMPLE_CALLBOARD_LISTING_PAGE_HTML,
	SAMPLE_CONTACT_CARD_PAGE_HTML,
	SAMPLE_DT_LIST_PAGE_HTML,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	SAMPLE_FEATURE_LIST_PAGE_HTML,
	SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML,
	SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML,
	SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML,
	SAMPLE_POSITION_CONTENT_PAGE_HTML,
	SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML,
	SAMPLE_ROSTER_DIRECTORY_PAGE_HTML,
	SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsDirectoryShellSuite() {
	it("extracts dt-based bulletin listings as main content while demoting top-bar and breadcrumb links", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_009",
			requestedUrl: "https://www.example.edu/index/gsgg.htm",
			finalUrl: "https://www.example.edu/index/gsgg.htm",
			responseBody: SAMPLE_DT_LIST_PAGE_HTML,
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-03-29T08:35:00.000Z",
		});

		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBeGreaterThanOrEqual(2);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "list_item" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("学生宿舍供电智能管理系统维保服务项目比选公告"),
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" && item.isNavigation && item.textNormalized === "学校官网",
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) => item.blockRole === "link" && item.isNavigation && item.textNormalized === "首页",
			),
		).toBe(true);
	});

	it("keeps section heading context for feature-list sections on list items and retained child links", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_010",
			requestedUrl: "https://www.example.edu/feature-list.htm",
			finalUrl: "https://www.example.edu/feature-list.htm",
			responseBody: SAMPLE_FEATURE_LIST_PAGE_HTML,
			fetchedAt: "2026-03-29T08:36:00.000Z",
		});

		const listItem = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "list_item" &&
				(item.textNormalized ?? "").includes("全国两会上民大人声音"),
		);
		const contentLink = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "link" &&
				item.linkTarget === "https://www.example.edu/info/1003/4704.htm",
		);

		expect(listItem?.parentHeadingPath).toEqual(["校友会动态"]);
		expect(contentLink?.isMainContent).toBe(false);
		expect(contentLink?.parentHeadingPath).toEqual(["校友会动态"]);
	});

	it("does not mark duplicated parent li and child paragraph text as repeated when both are main content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_011",
			requestedUrl: "https://www.example.edu/contact.htm",
			finalUrl: "https://www.example.edu/contact.htm",
			responseBody: SAMPLE_CONTACT_CARD_PAGE_HTML,
			fetchedAt: "2026-03-29T08:37:00.000Z",
		});

		const duplicatedBlocks = pageArtifacts.contentBlocks.filter(
			(item) => (item.textNormalized ?? "").includes("010-68932500") && item.isMainContent,
		);

		expect(duplicatedBlocks.length).toBe(2);
		expect(duplicatedBlocks.every((item) => item.isRepeatedCandidate === false)).toBe(true);
	});

	it("ignores hidden placeholder text when classifying dynamic shell pages", () => {
		const pageArtifacts = buildPageArtifactsForTest({
			crawlRunId: "owrun_test_012",
			requestedUrl: "https://www.example.edu/library.htm",
			finalUrl: "https://www.example.edu/library.htm",
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-29T08:38:00.000Z",
		});

		const matchingBlocks = pageArtifacts.contentBlocks.filter(
			(item) => item.textNormalized === "中央民族大学图书馆",
		);
		const titleBlock = matchingBlocks.find((item) => item.blockRole === "title");

		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("dynamic_shell_page");
		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
		expect(matchingBlocks).toHaveLength(1);
		expect(titleBlock?.isRepeatedCandidate).toBe(false);
	});

	it("classifies empty listing shells as structural shell pages instead of generic content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012b",
			requestedUrl: "https://www.example.edu/training/undergraduate.htm",
			finalUrl: "https://www.example.edu/training/undergraduate.htm",
			responseBody: SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-29T09:01:00.000Z",
		});

		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
	});

	it("classifies image-only body shells as structural shell pages", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012c",
			requestedUrl: "https://www.example.edu/overview/dean.htm",
			finalUrl: "https://www.example.edu/overview/dean.htm",
			responseBody: SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-29T09:02:00.000Z",
		});

		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
	});

	it("retains source-truth image references without promoting image-only pages to text content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012c_media",
			requestedUrl: "https://www.example.edu/overview/dean.htm",
			finalUrl: "https://www.example.edu/overview/dean.htm",
			responseBody: SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-29T09:02:00.000Z",
		});

		const mediaBlocks = pageArtifacts.contentBlocks.filter(
			(item) =>
				item.blockRole === "metadata" &&
				item.linkTarget === "https://www.example.edu/images/dean-message.png",
		);

		expect(mediaBlocks).toHaveLength(1);
		expect(mediaBlocks[0]?.isMainContent).toBe(false);
		expect(mediaBlocks[0]?.htmlFragment).toContain("<img");
		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
	});

	it("classifies repeated-navigation zero-text shells as structural shell pages", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012d",
			requestedUrl: "https://www.example.edu/sport/index.htm",
			finalUrl: "https://www.example.edu/sport/index.htm",
			responseBody: SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML,
			fetchedAt: "2026-03-29T09:04:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
		expect(
			pageArtifacts.providerExtraction.pageSignals.repeatedNonMainBlockCount,
		).toBeGreaterThanOrEqual(40);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
	}, 15_000);

	it("keeps dated link listings with gallery-like titles out of gallery_page", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012e",
			requestedUrl: "https://www.example.edu/party/branch-highlights.htm",
			finalUrl: "https://www.example.edu/party/branch-highlights.htm",
			responseBody: SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML,
			fetchedAt: "2026-03-29T09:05:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(4);
		expect(
			pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount,
		).toBeGreaterThanOrEqual(4);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	});

	it("treats callboard-style central publication lists as main-content listings", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012f",
			requestedUrl: "https://www.example.edu/zxgk.htm",
			finalUrl: "https://www.example.edu/zxgk.htm",
			responseBody: SAMPLE_CALLBOARD_LISTING_PAGE_HTML,
			fetchedAt: "2026-03-29T18:20:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
		expect(
			pageArtifacts.providerExtraction.pageSignals.mainContentCharacterCount,
		).toBeGreaterThanOrEqual(24);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
	}, 15_000);

	it("does not treat position__content roster sections as navigation boilerplate", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012g",
			requestedUrl: "https://www.example.edu/xygk/dw2020.htm",
			finalUrl: "https://www.example.edu/xygk/dw2020.htm",
			responseBody: SAMPLE_POSITION_CONTENT_PAGE_HTML,
			fetchedAt: "2026-03-29T23:40:00.000Z",
		});

		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "heading" &&
					item.isMainContent &&
					item.textNormalized === "计算机系教工党支部",
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "paragraph" &&
					item.isMainContent &&
					(item.textNormalized ?? "").includes("支部书记兼统战委员 赵悦"),
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" &&
					item.isMainContent &&
					item.textNormalized === "支部书记兼统战委员",
			),
		).toBe(true);
	});

	it("classifies thin roster link pages on content sites as directory pages instead of generic content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012h",
			requestedUrl: "https://www.example.edu/szdw.htm",
			finalUrl: "https://www.example.edu/szdw.htm",
			responseBody: SAMPLE_ROSTER_DIRECTORY_PAGE_HTML,
			fetchedAt: "2026-03-30T12:10:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(2);
		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
	});

	it("classifies heading-only organization pages on content sites as directory pages instead of generic content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_012i",
			requestedUrl: "https://www.example.edu/jgsz.htm",
			finalUrl: "https://www.example.edu/jgsz.htm",
			responseBody: SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML,
			fetchedAt: "2026-03-30T12:11:00.000Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainHeadingCount).toBeGreaterThanOrEqual(3);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBe(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
	});
}
