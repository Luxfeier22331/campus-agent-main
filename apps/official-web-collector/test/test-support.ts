import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(TEST_DIR, "fixtures", "pages");

export function writeTestConfigRoot(): { configRoot: string; outputDir: string } {
	const root = mkdtempSync(resolve(tmpdir(), "official-web-collector-"));
	const configRoot = resolve(root, "official_web");
	const siteRoot = resolve(configRoot, "campus_public");
	mkdirSync(siteRoot, { recursive: true });

	writeFileSync(
		resolve(siteRoot, "site.json"),
		JSON.stringify(
			{
				schema_version: "official_web_site_config.v1",
				config_version: "campus_public.v1",
				site_id: "campus_public",
				display_name: "Campus public",
				source_channel: "official_web",
				entry_host: "www.example.edu",
				allowed_hosts: ["www.example.edu"],
				seed_set_version: "campus_public_seeds_v1",
				host_policy_version: "campus_public_hosts_v1",
				crawl_policy_version: "campus_public_crawl_policy_v1",
				projection_policy_version: "campus_public_projection_v1",
				credentials_mode: "public",
				user_agent: "collector-test/1.0",
				request_timeout_ms: 15000,
				request_handler_timeout_ms: 30000,
				max_request_retries: 2,
				max_redirect_hops: 5,
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "hosts.json"),
		JSON.stringify(
			{
				schema_version: "official_web_host_policy.v1",
				site_id: "campus_public",
				host_policy_version: "campus_public_hosts_v1",
				hosts: [
					{
						host: "www.example.edu",
						public_kind: "directory_site",
						enabled: true,
						seed_urls: ["https://www.example.edu/"],
						allowed_path_prefixes: ["/"],
						denied_path_patterns: ["^/login"],
						query_param_allowlist: ["id"],
						max_depth: 2,
						max_pages_per_run: 10,
						max_concurrency: 1,
						min_delay_ms: 1000,
						respect_robots: true,
						explicit_sitemaps: [],
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "seeds.json"),
		JSON.stringify(
			{
				schema_version: "official_web_seed_set.v1",
				site_id: "campus_public",
				seed_set_version: "campus_public_seeds_v1",
				seeds: [
					{
						seed_id: "home",
						url: "https://www.example.edu/",
						host: "www.example.edu",
						reason: "homepage",
						discovery_method: "seed",
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "crawl-policy.json"),
		JSON.stringify(
			{
				schema_version: "official_web_crawl_policy.v1",
				site_id: "campus_public",
				crawl_policy_version: "campus_public_crawl_policy_v1",
				scheme_allowlist: ["https"],
				content_type_allowlist: ["text/html"],
				discovery_order: ["seed", "navigation"],
				default_query_policy: "deny_all",
				default_query_param_allowlist: [],
				default_denied_path_patterns: ["^/search"],
				frontier_identity_key: "normalized_canonical_url",
				expand_within_same_hostname_only: true,
				cross_host_expansion_requires_allowlist: true,
				allow_cross_host_redirect_only_if_allowlisted: true,
				respect_robots_by_default: true,
				robots_4xx_behavior: "allow",
				robots_429_behavior: "backoff_host",
				robots_5xx_behavior: "fail_closed_host",
				record_redirect_chain: true,
				use_conditional_fetch: true,
				max_total_pages_per_run: 10,
				max_total_failures_per_run: 10,
				max_runtime_minutes: 10,
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "credentials.schema.json"),
		JSON.stringify(
			{
				schema_version: "official_web_credentials_schema.v1",
				site_id: "campus_public",
				credentials_mode: "public",
				title: "public",
				description: "public",
				type: "object",
				additionalProperties: false,
				properties: {},
				required: [],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "scheduler-policy.json"),
		JSON.stringify(
			{
				schema_version: "official_web_scheduler_policy.v1",
				site_id: "campus_public",
				scheduler_policy_version: "campus_public_scheduler_v1",
				timezone: "Asia/Shanghai",
				lanes: [
					{
						enabled: true,
						run_intent: "baseline",
						cadence_minutes: 1440,
						host_filter: [],
						max_pages_per_host: 10,
						max_total_pages: 10,
						notes: "baseline coverage for all enabled hosts",
					},
					{
						enabled: true,
						run_intent: "hot",
						cadence_minutes: 30,
						host_filter: ["www.example.edu"],
						max_pages_per_host: 5,
						max_total_pages: 10,
						notes: "hot listing and recent detail refresh",
					},
					{
						enabled: true,
						run_intent: "repair",
						cadence_minutes: 120,
						host_filter: [],
						max_pages_per_host: 5,
						max_total_pages: 10,
						notes: "repair failed fetches",
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "qc-policy.json"),
		JSON.stringify(
			{
				schema_version: "official_web_qc_policy.v1",
				site_id: "campus_public",
				qc_policy_version: "campus_public_qc_v1",
				allowed_review_issue_codes: [],
				allowed_review_page_families: [],
				host_overrides: [],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "projection-declarations.json"),
		JSON.stringify(
			{
				schema_version: "official_web_projection_declarations.v1",
				site_id: "campus_public",
				projection_policy_version: "campus_public_projection_v1",
				declarations: [],
			},
			null,
			2,
		),
	);

	return {
		configRoot,
		outputDir: resolve(root, "output"),
	};
}

function readFixture(name: string): string {
	return readFileSync(resolve(FIXTURE_DIR, name), "utf-8").trim();
}

export const SAMPLE_PAGE_HTML = readFixture("sample-page.html");
export const SAMPLE_HOME_PAGE_HTML = readFixture("sample-home-page.html");
export const SAMPLE_DIRECTORY_PAGE_HTML = readFixture("sample-directory-page.html");
export const SAMPLE_ROSTER_DIRECTORY_PAGE_HTML = readFixture("sample-roster-directory-page.html");
export const SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML = readFixture(
	"sample-organization-directory-page.html",
);
export const SAMPLE_NEWS_HOME_PAGE_HTML = readFixture("sample-news-home-page.html");
export const SAMPLE_NEWS_ARTICLE_DETAIL_HTML = readFixture("sample-news-article-detail.html");
export const SAMPLE_HISTORY_HOME_CARD_PAGE_HTML = readFixture("sample-history-home-card-page.html");
export const SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML = readFixture(
	"sample-law-dense-roster-directory-page.html",
);
export const SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML = readFixture(
	"sample-law-tabmenu-directory-page.html",
);
export const SAMPLE_DT_LIST_PAGE_HTML = readFixture("sample-dt-list-page.html");
export const SAMPLE_FEATURE_LIST_PAGE_HTML = readFixture("sample-feature-list-page.html");
export const SAMPLE_CONTACT_CARD_PAGE_HTML = readFixture("sample-contact-card-page.html");
export const SAMPLE_DYNAMIC_SHELL_PAGE_HTML = readFixture("sample-dynamic-shell-page.html");
export const SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML = readFixture(
	"sample-image-structural-shell-page.html",
);
export const SAMPLE_STRUCTURAL_SHELL_PAGE_HTML = readFixture("sample-structural-shell-page.html");
export const SAMPLE_SPORT_CARD_HOME_PAGE_HTML = readFixture("sample-sport-card-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_HTML = readFixture("sample-xiaoyou-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML = readFixture(
	"sample-xiaoyou-home-page-title-attr.html",
);
export const SAMPLE_XIAOYOU_LIST_PAGE_HTML = readFixture("sample-xiaoyou-list-page.html");
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
          中央民族大学研究生教育始于上世纪五十年代，始终坚持厚基础、宽视野、重创新的人才培养理念，全面深化研究生教育综合改革。
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
            <a href="/info/1063/6543.htm">中央民族大学体育学院2026年体育硕士招生调剂方案</a>
            <div class="summary">根据上级和学校有关规定，体育学院拟接受 2026 年体育硕士专业学位调剂生。</div>
            <div class="publish-date">2026-03-30</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();
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
