import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OfficialWebPageTargetMatch } from "../src/core/index.ts";
import type { OfficialWebCrawlCandidate } from "../src/crawl-candidates";

export { writeTestConfigRoot } from "./test-config-root";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ASSERTION_DIR = resolve(TEST_DIR, "assertions", "pages");

function readAssertion(name: string): string {
	return readFileSync(resolve(ASSERTION_DIR, name), "utf-8").trim();
}

export const SAMPLE_PAGE_HTML = readAssertion("sample-page.html");
export const SAMPLE_HOME_PAGE_HTML = readAssertion("sample-home-page.html");
export const SAMPLE_DIRECTORY_PAGE_HTML = readAssertion("sample-directory-page.html");
export const SAMPLE_ROSTER_DIRECTORY_PAGE_HTML = readAssertion("sample-roster-directory-page.html");
export const SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML = readAssertion(
	"sample-organization-directory-page.html",
);
export const SAMPLE_NEWS_HOME_PAGE_HTML = readAssertion("sample-news-home-page.html");
export const SAMPLE_NEWS_ARTICLE_DETAIL_HTML = readAssertion("sample-news-article-detail.html");
export const SAMPLE_HISTORY_HOME_CARD_PAGE_HTML = readAssertion(
	"sample-history-home-card-page.html",
);
export const SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML = readAssertion(
	"sample-law-dense-roster-directory-page.html",
);
export const SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML = readAssertion(
	"sample-law-tabmenu-directory-page.html",
);
export const SAMPLE_DT_LIST_PAGE_HTML = readAssertion("sample-dt-list-page.html");
export const SAMPLE_FEATURE_LIST_PAGE_HTML = readAssertion("sample-feature-list-page.html");
export const SAMPLE_CONTACT_CARD_PAGE_HTML = readAssertion("sample-contact-card-page.html");
export const SAMPLE_DYNAMIC_SHELL_PAGE_HTML = readAssertion("sample-dynamic-shell-page.html");
export const SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML = readAssertion(
	"sample-image-structural-shell-page.html",
);
export const SAMPLE_STRUCTURAL_SHELL_PAGE_HTML = readAssertion("sample-structural-shell-page.html");
export const SAMPLE_SPORT_CARD_HOME_PAGE_HTML = readAssertion("sample-sport-card-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_HTML = readAssertion("sample-xiaoyou-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML = readAssertion(
	"sample-xiaoyou-home-page-title-attr.html",
);
export const SAMPLE_XIAOYOU_LIST_PAGE_HTML = readAssertion("sample-xiaoyou-list-page.html");
export const SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>人才培养 - Campus public</title>
    <script>
      window.__PAGE_DATA__ = {};
      $(".detail-shell").load("/api/training");
    </script>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <a href="/index.htm">首页</a>
        <a href="/rcpy.htm">人才培养</a>
      </nav>
    </header>
    <div class="page-shell">
      <div class="left-nav sidebar">
        <a href="/bkjy.htm">本科教育</a>
        <a href="/yjsjy.htm">研究生教育</a>
      </div>
      <div class="detail-shell">
        <div class="hq-p">
          示例大学研究生教育始于上世纪五十年代，始终坚持厚基础、宽视野、重创新的人才培养理念，全面深化研究生教育综合改革。
        </div>
        <div class="hq-p">
          学校围绕学科建设、队伍建设、人才培养和科学研究等目标制定专项计划，持续提升学生创新能力与国际化能力。
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();
export const SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>体育学院 - Campus public</title>
    <script>
      window.__INITIAL_STATE__ = {};
    </script>
  </head>
  <body>
    <header>
      <div class="site-nav">
        <a href="/index.htm">首页</a>
        <a href="/xygk.htm">学院概况</a>
      </div>
    </header>
    <div class="homepage-shell">
      <div class="panel-body">
        <div class="news-panel">
          <div class="panel-title">学院新闻</div>
          <div class="news-card">
            <a href="/info/1062/6423.htm">温暖入心，关怀入寝：体育学院开展春季学期宿舍走访</a>
            <div class="summary">学院围绕学生发展与宿舍安全开展专项走访，并形成后续服务安排。</div>
            <div class="publish-date">2026-03-30</div>
          </div>
          <div class="news-card">
            <a href="/info/1062/6343.htm">凝心聚力谋发展 砥砺奋进启新程：体育学院召开年度工作会</a>
            <div class="summary">会议围绕党建思政、学科建设与训练工作安排年度重点任务。</div>
            <div class="publish-date">2026-03-18</div>
          </div>
        </div>
        <div class="notice-panel">
          <div class="panel-title">通知公告</div>
          <div class="notice-card">
            <a href="/info/1063/6543.htm">示例大学体育学院2026年体育硕士招生调剂方案</a>
            <div class="summary">根据上级和学校有关规定，体育学院拟接受 2026 年体育硕士专业学位调剂生。</div>
            <div class="publish-date">2026-03-30</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();

export function buildOfficialWebPlannerPageForTest(
	overrides: Partial<OfficialWebCrawlCandidate> = {},
): OfficialWebCrawlCandidate {
	return {
		cadenceClass: "target_candidate",
		consumerFamily: "stable_reference_candidate",
		contentType: "text/html",
		discoveredFromUrl: null,
		discoveryMethod: "manual_requeue",
		etag: null,
		fetchProfile: "target_candidate_fetch",
		host: "www.example.edu",
		hostPolicy: {
			host: "www.example.edu",
			sourceHost: "www.example.edu",
		},
		inventoryOnly: false,
		lastChangeReason: "target_candidate_admitted",
		lastChangedAt: null,
		lastFetchDisposition: "never_fetched",
		lastHttpStatus: null,
		lastModified: null,
		lastNotModifiedAt: null,
		lastSeenAt: "2026-05-01T08:00:00.000Z",
		lastSuccessfulRunId: null,
		mainContentHash: null,
		materializationPolicy: "stable_reference_release_gate",
		nextEligibleFetchAt: "2026-05-01T08:00:00.000Z",
		normalizedCanonicalUrl: "https://www.example.edu/",
		pageFamily: "article_detail",
		pageTitleNormalized: "Example target",
		priorityScore: 90,
		responseBodyHash: null,
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "official_web_target_release_gate",
		selectedWriteTarget: "official_web/stable_reference",
		siteId: "campus_public",
		targetCandidateId: "owcand_target",
		targetDeclarationVersion: "campus_public_target_source_map_v2",
		targetId: "official-web-stable-reference",
		targetJobId: "owtarget_stable_reference",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

export function buildOfficialWebTargetMatchForTest(
	overrides: Partial<OfficialWebPageTargetMatch> = {},
): OfficialWebPageTargetMatch {
	return {
		consumerFamily: "stable_reference_candidate",
		materializationPolicy: "release_gate_required",
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "official_web_target_release_gate",
		selectedWriteTarget: "official_web/stable_reference",
		targetCandidateId: "owcand_target",
		targetDeclarationVersion: "campus_public_target_source_map_v2",
		targetId: "official-web-stable-reference",
		targetJobId: "owtarget_stable_reference",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

export function buildTargetWorksetCandidatesForTest(
	input: { duePages?: OfficialWebCrawlCandidate[]; runId?: string } = {},
): OfficialWebCrawlCandidate[] {
	void input.runId;
	const duePages = input.duePages ?? [buildOfficialWebPlannerPageForTest()];
	return duePages;
}
export const SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>信息工程学院 - Campus public</title>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <a href="/index.htm">网站首页</a>
        <a href="/xygk/xyjj.htm">学院概况</a>
      </nav>
    </header>
    <main class="page-main">
      <section class="news-list">
        <ul>
          <li class="news-item">
            <div class="news-time">2026-02-12</div>
            <div class="news-content">
              <dl>
                <dt>
                  <a href="javascript:void(0)" onclick="opennews('info/1040/6035.htm')">
                    教育部重点实验室与中国中医科学院中国医史文献研究所开展学术交流
                  </a>
                </dt>
                <dd>
                  <a class="news-detail" href="javascript:void(0)" onclick="opennews('info/1040/6035.htm')">
                    详细内容&gt;
                  </a>
                </dd>
              </dl>
            </div>
          </li>
          <li class="news-item">
            <div class="news-time">2026-01-01</div>
            <div class="news-content">
              <dl>
                <dt>
                  <a href="javascript:void(0)" onclick="opennews('info/1040/6036.htm')">
                    AI赋能交叉学科，一校三址共享优质教学资源
                  </a>
                </dt>
                <dd>
                  <a class="news-detail" href="javascript:void(0)" onclick="opennews('info/1040/6036.htm')">
                    详细内容&gt;
                  </a>
                </dd>
              </dl>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </body>
</html>
`.trim();

export const SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>关于举办2026年春季线上图采会活动通知</title>
  </head>
  <body>
    <div id="index">
      <div class="info-box">
        <div class="txt-c">
          <h1 class="title fz-title">关于举办2026年春季线上图采会活动通知</h1>
          <div class="time fz-time">
            <span class="mg-r16">发布时间：2026-03-18 09:44:37</span>
          </div>
        </div>
        <div class="content noteContent richtext" id="editor1">
          <!-- 当前内容加载异常，请确认您当前网络是否连通互联网或者联系门户管理员！-->
        </div>
      </div>
    </div>
    <div id="audioDiv" style="z-index: 9000; display: none;">
      <div class="grid-music-container f-usn">
        <div class="m-music-lyric-wrap">
          <div class="inner">
            <ul class="js-music-lyric-content">
              <li class="eof">暂无歌词...</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <script>
      var app = {
        renderRichtext: function (_targetId, _content) {},
      };
      var bootstrap = {
        data: {
          "content": "<p>各位师生/读者：</p><p>春启新篇，书香聚力。2026年春季线上图采会将于3月23日至3月27日在线上举办。</p><p>具体操作方式如下：点击右上角登录，输入用户名后进入图采会完成荐购。</p><p><a href=\\"https://d.cxstar.com/\\" target=\\"_blank\\">https://d.cxstar.com/</a></p>",
          "1": {
            "pageType": 1,
            "value": "关于举办2026年春季线上图采会活动通知",
            "key": "标题",
            "url": ""
          }
        }
      };
      var content = bootstrap.data.content;
      app.renderRichtext("editor1", content);
    </script>
  </body>
</html>
`.trim();

export const SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>资源动态详情</title>
  </head>
  <body>
    <div class="info-box">
      <h1 class="title fz-title">资源动态详情</h1>
      <div class="time fz-time">
        <span>发布时间：2026-03-31 11:17:42</span>
      </div>
      <div class="content noteContent richtext" id="editor1"></div>
    </div>
  </body>
</html>
`.trim();
