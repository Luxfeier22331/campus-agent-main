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
    <title>关于举办示例大学第四届学生信息素养大赛的通知</title>
  </head>
  <body>
    <header class="nav">
      <a href="/engine2/general/more?appId=537849&websiteId=64168&wfwfid=24149&pageId=87948&typeId=3049665&currentBranch=0">数字资源</a>
    </header>
    <main id="vsb_content">
      <h1>关于举办示例大学第四届学生信息素养大赛的通知</h1>
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

const SAMPLE_VSB_BR_REGULATION_DETAIL_WITH_FOOTER_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>示例大学学术委员会章程-示例大学信息公开</title>
  </head>
  <body>
    <div class="top-nav">
      <a href="/index.htm">首页</a>
      <a href="/gzzd.htm">规章制度</a>
    </div>
    <form name="_newscontent_fromname">
      <div class="gcontent">
        <center>
          <h1 align="center">示例大学学术委员会章程</h1>
        </center>
        <center>
          <span>作者：admin 来源：未知更新时间：14-11-06 17:56</span>
        </center>
        <div id="vsb_content" class="gtext">
          <div class="v_news_content">
            民大校发〔2013〕140号<br />
            第一章 总 则<br />
            第一条 为进一步提高我校科研水平和服务社会能力，努力把我校建设成为特色鲜明、国际知名的高水平研究型大学，根据《中华人民共和国高等教育法》，特制定本章程。<br />
            第二条 示例大学学术委员会是由本校专家学者代表组成的学术评议、审议和学术决策、咨询机构。<br />
            第三条 示例大学学术工作的重要决策一般须经校学术委员会审议通过后，由学校发布实施。<br />
            第二章 组织机构<br />
            第四条 校学术委员会由学术造诣高、学风端正的具有正高级专业技术职称人员组成。<br />
            第五条 校学术委员会设主任1名，由校长担任。<br />
            第六条 校学术委员会下设若干学科组，负责授权的学术评议和审议工作。<br />
          </div>
        </div>
      </div>
    </form>
    <div class="footer">
      <p style="text-align: center;">Copyright@ 2018 -- 党委办公室 校长办公室 All Rights Reserved</p>
    </div>
  </body>
</html>`;

export function registerPageArtifactsDetailSuite() {
	it("extracts a checked-in real article detail assertion into stable article blocks", () => {
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
			"示例大学举办示例研究中心2025年度重大招标项目开题论证会",
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

	it("keeps thin engine2 detail pages thin instead of treating hidden audio placeholders as main content", () => {
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

	it("extracts VSB br-separated regulation bodies through the reader extraction path", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_vsb_regulation_shell_review",
			requestedUrl: "https://www.example.edu/info/1198/4101.htm",
			finalUrl: "https://www.example.edu/info/1198/4101.htm",
			responseBody: SAMPLE_VSB_BR_REGULATION_DETAIL_WITH_FOOTER_HTML,
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/gzzd.htm",
			fetchedAt: "2026-05-05T09:00:00.000Z",
		});

		expect(pageArtifacts.pageManifest.mainContentBlockCount).toBeGreaterThanOrEqual(2);
		expect(pageArtifacts.providerExtraction.pageSignals.mainContentCharacterCount).toBeGreaterThan(
			260,
		);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) =>
					item.isMainContent &&
					(item.textNormalized ?? "").includes("第一条 为进一步提高我校科研水平"),
			),
		).toBe(true);
		expect(
			pageArtifacts.contentBlocks.some(
				(item) => item.isMainContent && (item.textNormalized ?? "").includes("Copyright@ 2018"),
			),
		).toBe(false);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
		expect(pageArtifacts.pageManifest.pageFamilyReason).toBe("paragraph_dominant_main_content");
	});
}
