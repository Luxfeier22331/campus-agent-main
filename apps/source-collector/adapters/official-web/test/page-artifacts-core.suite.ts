import { expect, it } from "vitest";

import {
	buildDirectorySiteArtifactsForTest,
	SAMPLE_DIRECTORY_PAGE_HTML,
	SAMPLE_HOME_PAGE_HTML,
	SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML,
	SAMPLE_PAGE_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsCoreSuite() {
	it("normalizes a fetched page into capture, provider, and source-truth artifacts", () => {
		const pageArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_001",
			requestedUrl: "https://www.example.edu/admissions?utm_source=wechat&id=9",
			finalUrl: "https://www.example.edu/admissions?id=9",
			declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
			responseBody: SAMPLE_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
				etag: "W/etag-001",
				"last-modified": "Sat, 29 Mar 2026 08:00:00 GMT",
			},
			fetchedAt: "2026-03-29T08:00:00.000Z",
		});

		expect(pageArtifacts.rawAssetId).toMatch(/^owasset_[a-f0-9]{24}$/);
		expect(pageArtifacts.rawVersionId).toMatch(/^owver_[a-f0-9]{24}$/);
		expect(pageArtifacts.pageManifest.normalizedCanonicalUrl).toBe(
			"https://www.example.edu/admissions?id=9",
		);
		expect(pageArtifacts.pageManifest.pageTitleNormalized).toBe("招生简章");
		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
		expect(pageArtifacts.pageManifest.languageHint).toBe("zh-CN");
		expect(pageArtifacts.pageManifest.blockCount).toBeGreaterThanOrEqual(4);
		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBeGreaterThanOrEqual(3);
		expect(pageArtifacts.pageManifest.navigationBlockCount).toBeGreaterThanOrEqual(1);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "heading" && item.textNormalized === "招生简章" && item.isMainContent,
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.blockRole === "link" && item.textNormalized === "关于学校" && item.isNavigation,
			),
		).toBe(true);
		expect(
			pageArtifacts.discoveredLinks.some(
				(item) =>
					item.linkText === "报名入口" &&
					item.resolvedUrl === "https://www.example.edu/admissions/apply?id=9" &&
					item.normalizedUrl === "https://www.example.edu/admissions/apply?id=9",
			),
		).toBe(true);
		expect(pageArtifacts.files.map((item) => item.relativePath)).toEqual([
			"capture/response.html",
			"capture/response-headers.json",
			"capture/fetch-metadata.json",
			"provider/cheerio-basic/page-extraction.json",
			"provider/cheerio-basic/discovered-links.jsonl",
			"source-truth/page-manifest.json",
			"source-truth/content-blocks.jsonl",
		]);
		expect(pageArtifacts.files.map((item) => item.objectKey)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("/capture/response.html"),
				expect.stringContaining("/provider/cheerio-basic/page-extraction.json"),
				expect.stringContaining("/source-truth/page-manifest.json"),
			]),
		);
	});

	it("collapses homepage and default index page variants into the same raw asset identity", () => {
		const homepageArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_002",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			responseBody: SAMPLE_HOME_PAGE_HTML,
			fetchedAt: "2026-03-29T08:10:00.000Z",
		});
		const indexArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_002",
			requestedUrl: "https://www.example.edu/index.htm",
			finalUrl: "https://www.example.edu/index.htm",
			responseBody: SAMPLE_HOME_PAGE_HTML,
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-03-29T08:11:00.000Z",
		});

		expect(homepageArtifacts.pageManifest.normalizedCanonicalUrl).toBe("https://www.example.edu/");
		expect(indexArtifacts.pageManifest.normalizedCanonicalUrl).toBe("https://www.example.edu/");
		expect(indexArtifacts.rawAssetId).toBe(homepageArtifacts.rawAssetId);
		expect(indexArtifacts.rawVersionId).toBe(homepageArtifacts.rawVersionId);
	});

	it("demotes directory service-link list items out of main content", () => {
		const pageArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_003",
			requestedUrl: "https://www.example.edu/student-services.htm",
			finalUrl: "https://www.example.edu/student-services.htm",
			responseBody: SAMPLE_DIRECTORY_PAGE_HTML,
			fetchedAt: "2026-03-29T08:20:00.000Z",
		});

		const serviceBlocks = pageArtifacts.contentBlocks.filter(
			(item) =>
				item.blockRole === "list_item" &&
				["官方微博", "民大资讯", "网络教学综合平台", "图书馆"].includes(item.textNormalized ?? ""),
		);

		expect(serviceBlocks).toHaveLength(4);
		expect(serviceBlocks.every((item) => item.isMainContent === false)).toBe(true);
	});

	it("keeps tabmenu roster links as directory main content instead of navigation boilerplate", () => {
		const pageArtifacts = buildDirectorySiteArtifactsForTest({
			crawlRunId: "owrun_test_003b",
			requestedUrl: "https://www.example.edu/szdw1.htm",
			finalUrl: "https://www.example.edu/szdw1.htm",
			responseBody: SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML,
			fetchedAt: "2026-04-02T12:10:00.000Z",
		});

		const rosterLinks = pageArtifacts.contentBlocks.filter(
			(item) =>
				item.blockRole === "link" &&
				item.isMainContent &&
				["田飞龙", "涂卫", "王剑", "王云霞", "崔洪夫"].includes(item.textNormalized ?? ""),
		);

		expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
		expect(rosterLinks.map((item) => item.textNormalized)).toEqual([
			"田飞龙",
			"涂卫",
			"王剑",
			"王云霞",
			"崔洪夫",
		]);
	});
}
