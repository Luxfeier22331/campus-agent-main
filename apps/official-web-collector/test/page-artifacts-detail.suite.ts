import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
	SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
	SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
	SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
} from "./page-artifacts-test-support";

const SAMPLE_ENGINE2_PARAGRAPH_HEAVY_DETAIL_WITH_LINKS_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>关于举办中央民族大学第四届学生信息素养大赛的通知</title>
  </head>
  <body>
    <header class="nav">
      <a href="/engine2/general/more?appId=537849&websiteId=64168&wfwfid=24149&pageId=87948&typeId=3049665&currentBranch=0">数字资源</a>
    </header>
    <main id="vsb_content">
      <h1>关于举办中央民族大学第四届学生信息素养大赛的通知</h1>
      <p>各学院、各单位：</p>
      <p>为提升学生信息素养与人工智能应用能力，学校将组织开展第四届学生信息素养大赛校内选拔赛。</p>
      <p>一、参赛对象：全体在校本科生、研究生。</p>
      <p>二、报名时间：2026年4月25日至2026年5月10日。</p>
      <p>三、初赛时间：2026年5月15日，复赛时间：2026年5月25日。</p>
      <p>四、报名方式：请访问 <a href="https://contest.example.edu/register">报名系统</a> 完成报名。</p>
      <p>五、资料下载：<a href="https://contest.example.edu/guide">参赛指南</a>、<a href="https://contest.example.edu/rules">竞赛规则</a>、<a href="https://contest.example.edu/faq">常见问题</a>。</p>
      <p>联系人：图书馆知识服务部，电话 010-68930000。</p>
      <p>图书馆、教务处</p>
      <p>2026年4月25日</p>
    </main>
  </body>
</html>`;

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

	it("classifies paragraph-heavy engine2 detail pages with date and link chrome as article details", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_engine2_paragraph_heavy",
			requestedUrl: "https://www.example.edu/engine2/d/9285493/699558/0",
			finalUrl: "https://www.example.edu/engine2/d/9285493/699558/0",
			responseBody: SAMPLE_ENGINE2_PARAGRAPH_HEAVY_DETAIL_WITH_LINKS_HTML,
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-04-27T21:32:34.490Z",
		});

		expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThan(4);
		expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(4);
		expect(
			pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount,
		).toBeGreaterThanOrEqual(4);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
		expect(pageArtifacts.pageManifest.pageFamilyReason).toBe("paragraph_dominant_main_content");
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
