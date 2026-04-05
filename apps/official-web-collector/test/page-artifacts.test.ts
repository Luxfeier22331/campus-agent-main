import { load } from "cheerio";
import { buildOfficialWebCrawlPlan, findOfficialWebHostPolicy, loadOfficialWebConfig } from "official-web-core";
import { describe, expect, it } from "vitest";

import {
  SAMPLE_CONTACT_CARD_PAGE_HTML,
  SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
  SAMPLE_DIRECTORY_PAGE_HTML,
  SAMPLE_DT_LIST_PAGE_HTML,
  SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
  SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
  SAMPLE_FEATURE_LIST_PAGE_HTML,
  SAMPLE_HISTORY_HOME_CARD_PAGE_HTML,
  SAMPLE_HOME_PAGE_HTML,
  SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML,
  SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML,
  SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML,
  SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
  SAMPLE_NEWS_HOME_PAGE_HTML,
  SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
  SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML,
  SAMPLE_PAGE_HTML,
  SAMPLE_ROSTER_DIRECTORY_PAGE_HTML,
  SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
  SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
  SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
  SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML,
  SAMPLE_XIAOYOU_HOME_PAGE_HTML,
  SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML,
  SAMPLE_XIAOYOU_LIST_PAGE_HTML,
  writeTestConfigRoot,
} from "./test-support";

import * as pageArtifactsModule from "../src/page-artifacts";

const SAMPLE_DISCLOSURE_TABLE_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>信息公开 - Campus public</title>
  </head>
  <body>
    <main>
      <h1>信息公开目录</h1>
      <table class="disclosure-table">
        <tr>
          <th>事项</th>
          <th>材料</th>
          <th>更新时间</th>
        </tr>
        <tr>
          <td>招生政策</td>
          <td><a href="/docs/zs.pdf">招生章程</a></td>
          <td>2026年03月20日</td>
        </tr>
        <tr>
          <td>学位授予</td>
          <td><a href="/docs/xw.pdf">学位授予办法</a></td>
          <td>2026年03月18日</td>
        </tr>
      </table>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_GALLERY_TABLE_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>学院风采 - Campus public</title>
  </head>
  <body>
    <section class="content">
      <table class="gallery-table">
        <tr>
          <td>
            <table class="gallery-inner">
              <tr>
                <td>
                  <a href="/info/1001/1.htm">
                    <img src="/images/a.jpg" alt="李剑老师团队在少数民族地区调研" />
                    李剑老师团队在少数民族地区调研
                  </a>
                </td>
                <td>
                  <a href="/info/1001/2.htm">
                    <img src="/images/b.jpg" alt="崔玲玲老师在做田野调查" />
                    崔玲玲老师在做田野调查
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </section>
  </body>
</html>
`.trim();

const REPEATED_NAV_ITEMS = Array.from(
  { length: 25 },
  (_value, index) => `<li><a href="/section/${index + 1}.htm">栏目${index + 1}</a></li>`,
).join("");

const SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>体育学院 - Campus public</title>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <ul>${REPEATED_NAV_ITEMS}</ul>
      </nav>
    </header>
    <section class="hero">
      <img src="/images/hero.jpg" alt="" />
    </section>
    <aside class="section-sidebar">
      <ul>${REPEATED_NAV_ITEMS}</ul>
    </aside>
  </body>
</html>
`.trim();

const SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML = `
<!doctype html>
<html lang="zh-cn">
  <head>
    <title>中央民族大学新闻网</title>
  </head>
  <body>
    <header>
      <ul>${REPEATED_NAV_ITEMS}</ul>
    </header>
    <div class="adNav">
      <ul>${REPEATED_NAV_ITEMS}</ul>
    </div>
    <main>
      <section class="hero">
        <h2>校长强世功接受“统战新语”专访 解读民族团结进步促进法</h2>
        <p>从北京到边疆，从课堂到田野，一场关于“铸牢”教育的系统探索，正在中央民族大学稳步开展。</p>
        <div class="tabs">
          <span>教学科研</span>
          <span>校园经纬</span>
          <span>全球合作</span>
        </div>
        <div class="card">
          <h3><a href="/info/1.htm">中央民族大学党委举办树立和践行正确政绩观学习教育读书班</a></h3>
        </div>
        <div class="card">
          <h3><a href="/info/2.htm">中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破</a></h3>
        </div>
        <div class="card">
          <h3><a href="/info/3.htm">《学习时报》孔新峰：政德何以重要</a></h3>
          <p>
            新闻网讯 3月23日，《学习时报》刊发中央民族大学马克思主义学院党委书记、院长孔新峰教授撰写的理论文章《政德何以重要》，文章指出：新时代新征程对干部治理能力提出更高要求，政德建设成为干部队伍建设的关键抓手。政德作为党员干部从政履职的根本道德准则，是中华传统政治文明一脉相承的精神内核，唯有筑牢政德底...
          </p>
        </div>
        <div class="card">
          <p>2026“春晓逐梦”启航跑：迎着春光，和奥运选手一...</p>
        </div>
      </section>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>科学研究 - Campus public</title>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <ul>${REPEATED_NAV_ITEMS}</ul>
      </nav>
    </header>
    <section class="toolbar">
      <ul>
        <li><a href="javascript:void(0);">手机版</a></li>
      </ul>
    </section>
    <aside class="sidebar">
      <ul>${REPEATED_NAV_ITEMS}</ul>
    </aside>
  </body>
</html>
`.trim();

const SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>硕士生培养 - Campus public</title>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <a href="/index.htm">首页</a>
        <a href="/jyjx.htm">教育教学</a>
      </nav>
    </header>
    <main class="page-main">
      <section class="news-list">
        <ul>
          <li>
            <span>2022-09-19</span>
            <a href="/info/1019/2393.htm">硕士培养方案</a>
          </li>
        </ul>
      </section>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>支部风采 - Campus public</title>
  </head>
  <body>
    <div class="list_right">
      <ul class="right_list">
        <li>
          <div class="sj">
            <p class="p1">06</p>
            <p class="p2">2025.11</p>
          </div>
          <div class="wz">
            <p class="p_bt"><a href="https://example.edu/post-1">艺术润心 科技筑梦</a></p>
          </div>
        </li>
        <li>
          <div class="sj">
            <p class="p1">31</p>
            <p class="p2">2025.10</p>
          </div>
          <div class="wz">
            <p class="p_bt"><a href="https://example.edu/post-2">乐韵医心 情暖共行</a></p>
          </div>
        </li>
        <li>
          <div class="sj">
            <p class="p1">16</p>
            <p class="p2">2025.10</p>
          </div>
          <div class="wz">
            <p class="p_bt"><a href="https://example.edu/post-3">红色共建活动预告</a></p>
          </div>
        </li>
        <li>
          <div class="sj">
            <p class="p1">30</p>
            <p class="p2">2025.09</p>
          </div>
          <div class="wz">
            <p class="p_bt"><a href="https://example.edu/post-4">铭记抗战精神 勇担时代使命</a></p>
          </div>
        </li>
      </ul>
    </div>
  </body>
</html>
`.trim();

const SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>欢迎光临中央民族大学历史文化学院网站</title>
  </head>
  <body>
    <main class="page-main">
      <section class="notice-board">
        <div class="section-title">
          <h2>
            资讯公告NEWS&amp;NOTICS
            <p>NEWS&amp;NOTICS</p>
          </h2>
        </div>
        <div class="notice-list">
          <ul class="right_list">
            <li class="news-card">
              <a href="/info/1001/1.htm">
                <p class="meta">2026-03-12</p>
                <h3 class="p_bt">2025-2026-1学期缓补考时间安排</h3>
              </a>
            </li>
            <li class="news-card">
              <a href="/info/1001/2.htm">
                <p class="meta">2026-03-10</p>
                <h3 class="p_bt">2026年3月历史学（强基计划）动态调整结果公示</h3>
              </a>
            </li>
            <li class="news-card">
              <a href="/info/1001/3.htm">
                <p class="summary">历史文化学院教师裴艾琳的学术专著于2025年10月由上海古籍出版社出版发行。</p>
                <p class="meta">2025-12-24</p>
                <h3 class="p_bt">我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行</h3>
              </a>
            </li>
            <li class="news-card">
              <a href="/info/1001/4.htm">
                <h3 class="p_bt">李鸿宾《唐后期河朔军镇胡汉员属本土化现象研究》专著出版</h3>
              </a>
            </li>
            <li class="news-card">
              <a href="/info/1001/5.htm">
                <h3 class="p_bt">薪火传书香 初心润桃李</h3>
              </a>
            </li>
            <li class="news-card">
              <a href="/info/1001/6.htm">
                <h3 class="p_bt">“清代各民族社会文化交融学术研讨会”顺利举行</h3>
              </a>
            </li>
          </ul>
        </div>
      </section>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_CALLBOARD_LISTING_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>中心概况 - Campus public</title>
  </head>
  <body>
    <div class="cic-header">
      <nav class="cic-navbar">
        <ul>
          <li><a href="/index.htm">首页</a></li>
          <li><a href="/zxgk.htm">中心概况</a></li>
        </ul>
      </nav>
    </div>
    <div class="cic-body">
      <div class="cic-main">
        <div class="cic-callboard">
          <div class="callboard-head">
            <span class="callboard-head-title">中心概况</span>
          </div>
          <div class="callboard-body">
            <div class="cic-publishment">
              <div class="publishment-head">
                <a href="/info/1001/2855.htm" class="publishment-title">讲座纪要（五）：关于中华民族共同体理论的几个问题</a>
                <span class="publishment-meta">2025/11/10</span>
              </div>
            </div>
            <div class="cic-publishment">
              <div class="publishment-head">
                <a href="/info/1001/2865.htm" class="publishment-title">讲座纪要（四）：推进马克思主义民族理论中国化时代化研究与学科建设</a>
                <span class="publishment-meta">2025/11/09</span>
              </div>
            </div>
            <div class="cic-publishment">
              <div class="publishment-head">
                <a href="/info/1001/2815.htm" class="publishment-title">讲座纪要（三）：两个共同体理念的世界意义</a>
                <span class="publishment-meta">2025/11/08</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();

const SAMPLE_POSITION_CONTENT_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>党委 - Campus public</title>
  </head>
  <body>
    <header>
      <nav>
        <a href="/index.htm">网站首页</a>
        <a href="/xygk/xyjj.htm">学院简介</a>
      </nav>
    </header>
    <div class="guide">
      <p>学院概况 &gt; 党委</p>
    </div>
    <div class="info">
      <div class="info__menu">
        <a href="/xygk/xyjj.htm">学院简介</a>
        <a href="/xygk/dw2020.htm">党委</a>
      </div>
      <div id="party__branch" class="info__list">
        <div class="info__title party__info__title">
          <h4>党委机构设置</h4>
        </div>
        <div class="position__content">
          <div class="title-box party-box">
            <h4>计算机系教工党支部</h4>
          </div>
          <div id="vsb_content">
            <ul class="list-paddingleft-2">
              <li>
                <p><a class="position">支部书记兼统战委员</a> <a class="person">赵悦</a></p>
              </li>
              <li>
                <p><a class="position">组织委员</a> <a class="person">徐晓娜</a></p>
              </li>
              <li>
                <p><a class="position">宣传委员</a> <a class="person">姜珊</a></p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();

describe("official-web-collector page artifacts", () => {
  function getBuildCollectedPageArtifacts() {
    const buildCollectedPageArtifacts = (
      pageArtifactsModule as {
        buildCollectedPageArtifacts?: (input: {
          bundle: ReturnType<typeof loadOfficialWebConfig>;
          plan: ReturnType<typeof buildOfficialWebCrawlPlan>;
          hostPolicy: NonNullable<
            ReturnType<typeof findOfficialWebHostPolicy>
          >;
          requestedUrl: string;
          finalUrl: string;
          declaredCanonicalUrl: string | null;
          responseBody: string;
          responseHeaders: Record<string, string | string[] | undefined>;
          httpStatus: number;
          contentType: string;
          discoveryMethod:
            | "seed"
            | "robots_sitemap"
            | "configured_sitemap"
            | "navigation"
            | "manual_requeue";
          discoveredFromUrl: string | null;
          fetchedAt: string;
          html: ReturnType<typeof load>;
        }) => {
          rawAssetId: string;
          rawVersionId: string;
          pageManifest: {
            normalizedCanonicalUrl: string;
            pageTitleNormalized: string;
            pageFamily: string;
            publishedAt: string | null;
            blockCount: number;
            mainContentBlockCount: number;
            navigationBlockCount: number;
            languageHint: string | null;
          };
          contentBlocks: Array<{
            blockRole: string;
            textNormalized: string | null;
            isNavigation: boolean;
            isMainContent: boolean;
            isRepeatedCandidate?: boolean;
            linkTarget?: string | null;
            parentHeadingPath?: string[];
            sectionHint?: string | null;
          }>;
          discoveredLinks: Array<{
            linkText: string | null;
            resolvedUrl: string | null;
            normalizedUrl: string | null;
          }>;
          files: Array<{
            relativePath: string;
            objectKey: string;
            contentType: string;
          }>;
          providerExtraction: {
            pageSignals: {
              zeroMainContent: boolean;
              mainHeadingCount: number;
              mainParagraphCount: number;
              mainListItemCount: number;
              mainLinkCount: number;
              dateLikeMainBlockCount: number;
              repeatedNonMainBlockCount: number;
              mainContentCharacterCount: number;
              structuralShellSignal?: boolean;
              listingTableCount: number;
              galleryTableCount: number;
            };
          };
        };
      }
    ).buildCollectedPageArtifacts;

    expect(buildCollectedPageArtifacts).toBeTypeOf("function");
    return buildCollectedPageArtifacts;
  }

  it("normalizes a fetched page into capture, provider, and source-truth artifacts", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_001",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/admissions?utm_source=wechat&id=9",
      finalUrl: "https://www.example.edu/admissions?id=9",
      declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
      responseBody: SAMPLE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
        etag: "W/etag-001",
        "last-modified": "Sat, 29 Mar 2026 08:00:00 GMT",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:00:00.000Z",
      html: load(SAMPLE_PAGE_HTML),
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
          item.blockRole === "heading" &&
          item.textNormalized === "招生简章" &&
          item.isMainContent,
      ),
    ).toBe(true);
    expect(
      pageArtifacts.contentBlocks.some(
        (item) =>
          item.blockRole === "link" &&
          item.textNormalized === "关于学校" &&
          item.isNavigation,
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_002",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const homepageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/",
      finalUrl: "https://www.example.edu/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:10:00.000Z",
      html: load(SAMPLE_HOME_PAGE_HTML),
    });
    const indexArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/index.htm",
      finalUrl: "https://www.example.edu/index.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "navigation",
      discoveredFromUrl: "https://www.example.edu/",
      fetchedAt: "2026-03-29T08:11:00.000Z",
      html: load(SAMPLE_HOME_PAGE_HTML),
    });

    expect(homepageArtifacts.pageManifest.normalizedCanonicalUrl).toBe("https://www.example.edu/");
    expect(indexArtifacts.pageManifest.normalizedCanonicalUrl).toBe("https://www.example.edu/");
    expect(indexArtifacts.rawAssetId).toBe(homepageArtifacts.rawAssetId);
    expect(indexArtifacts.rawVersionId).toBe(homepageArtifacts.rawVersionId);
  });

  it("demotes directory service-link list items out of main content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_003",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/student-services.htm",
      finalUrl: "https://www.example.edu/student-services.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_DIRECTORY_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:20:00.000Z",
      html: load(SAMPLE_DIRECTORY_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_003b",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/szdw1.htm",
      finalUrl: "https://www.example.edu/szdw1.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-02T12:10:00.000Z",
      html: load(SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML),
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

  it("suppresses aggregate news-card list items and strips script residue from extracted text", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_004",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/",
      finalUrl: "https://www.example.edu/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:30:00.000Z",
      html: load(SAMPLE_NEWS_HOME_PAGE_HTML),
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
          (item.textNormalized ?? "").includes("中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会"),
      ),
    ).toBe(true);
  });

  it("classifies portal-style news homepages with lead teaser and repeated chrome as listing pages", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_004aa",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/",
      finalUrl: "https://www.example.edu/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-02T12:20:00.000Z",
      html: load(SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.repeatedNonMainBlockCount).toBeGreaterThanOrEqual(20);
    expect(pageArtifacts.providerExtraction.pageSignals.mainHeadingCount).toBeGreaterThanOrEqual(4);
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("prefers title-only link text for aggregate card anchors and normalizes split day-month date text", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_004b",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/history/",
      finalUrl: "https://www.example.edu/history/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_HISTORY_HOME_CARD_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-02T12:00:00.000Z",
      html: load(SAMPLE_HISTORY_HOME_CARD_PAGE_HTML),
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
          ["历史文化学院2025年大事记", "2025-2026-1学期缓补考时间安排"].includes(item.textNormalized ?? ""),
      ),
    ).toHaveLength(0);
  });

  it("keeps mixed aggregate card listings as listing pages after duplicate title descendants are demoted", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_004c",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/history/mixed.htm",
      finalUrl: "https://www.example.edu/history/mixed.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-02T12:10:00.000Z",
      html: load(SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(6);
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(5);
    expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBeGreaterThanOrEqual(4);
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_005",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/news/xyjw.htm",
      finalUrl: "https://www.example.edu/news/xyjw.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:31:00.000Z",
      html: load(SAMPLE_NEWS_HOME_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_006",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/news/xyjw.htm",
      finalUrl: "https://www.example.edu/news/xyjw.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_NEWS_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:32:00.000Z",
      html: load(SAMPLE_NEWS_HOME_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_007",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/admissions?id=9",
      finalUrl: "https://www.example.edu/admissions?id=9",
      declaredCanonicalUrl: "https://www.example.edu/admissions?id=9",
      responseBody: SAMPLE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:33:00.000Z",
      html: load(SAMPLE_PAGE_HTML),
    });

    const footerBlock = pageArtifacts.contentBlocks.find(
      (item) => item.blockRole === "footer" && item.textNormalized === "Campus public 版权所有",
    );

    expect(footerBlock?.isNavigation).toBe(true);
    expect(footerBlock?.sectionHint ?? null).toBeNull();
    expect(footerBlock?.parentHeadingPath ?? []).toEqual([]);
  });

  it("extracts a checked-in real article detail fixture into stable article blocks", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_008",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/news/info/1011/61784.htm",
      finalUrl: "https://www.example.edu/news/info/1011/61784.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "navigation",
      discoveredFromUrl: "https://www.example.edu/news/zhxw.htm",
      fetchedAt: "2026-03-29T08:34:00.000Z",
      html: load(SAMPLE_NEWS_ARTICLE_DETAIL_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_engine2_bootstrap",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
      finalUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "manual_requeue",
      discoveredFromUrl: "https://www.example.edu/",
      fetchedAt: "2026-04-01T09:00:00.000Z",
      html: load(SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML),
    });

    expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
    expect(pageArtifacts.pageManifest.publishedAt).toBe("2026-03-18T09:44:37+08:00");
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(2);
    expect(pageArtifacts.providerExtraction.pageSignals.mainContentCharacterCount).toBeGreaterThan(40);
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_listing_publish_guard",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/history/list.htm",
      finalUrl: "https://www.example.edu/history/list.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "navigation",
      discoveredFromUrl: "https://www.example.edu/history/",
      fetchedAt: "2026-04-02T12:21:00.000Z",
      html: load(SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML),
    });

    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
    expect(pageArtifacts.pageManifest.publishedAt).toBeNull();
  });

  it("keeps unrecovered engine2 detail pages thin instead of treating hidden audio placeholders as main content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_engine2_thin",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
      finalUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "manual_requeue",
      discoveredFromUrl: "https://www.example.edu/",
      fetchedAt: "2026-04-01T09:05:00.000Z",
      html: load(SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
    expect(pageArtifacts.pageManifest.mainContentBlockCount).toBeLessThanOrEqual(2);
    expect(
      pageArtifacts.contentBlocks.some(
        (item) => item.isMainContent && (item.textNormalized ?? "").includes("暂无歌词"),
      ),
    ).toBe(false);
  });

  it("extracts dt-based bulletin listings as main content while demoting top-bar and breadcrumb links", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_009",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/index/gsgg.htm",
      finalUrl: "https://www.example.edu/index/gsgg.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_DT_LIST_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "navigation",
      discoveredFromUrl: "https://www.example.edu/",
      fetchedAt: "2026-03-29T08:35:00.000Z",
      html: load(SAMPLE_DT_LIST_PAGE_HTML),
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
        (item) => item.blockRole === "link" && item.isNavigation && item.textNormalized === "学校官网",
      ),
    ).toBe(true);
    expect(
      pageArtifacts.contentBlocks.some(
        (item) => item.blockRole === "link" && item.isNavigation && item.textNormalized === "首页",
      ),
    ).toBe(true);
  });

  it("keeps section heading context for feature-list sections on list items and retained child links", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_010",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/feature-list.htm",
      finalUrl: "https://www.example.edu/feature-list.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_FEATURE_LIST_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:36:00.000Z",
      html: load(SAMPLE_FEATURE_LIST_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_011",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/contact.htm",
      finalUrl: "https://www.example.edu/contact.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_CONTACT_CARD_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:37:00.000Z",
      html: load(SAMPLE_CONTACT_CARD_PAGE_HTML),
    });

    const duplicatedBlocks = pageArtifacts.contentBlocks.filter(
      (item) =>
        (item.textNormalized ?? "").includes("010-68932500") &&
        item.isMainContent,
    );

    expect(duplicatedBlocks.length).toBe(2);
    expect(duplicatedBlocks.every((item) => item.isRepeatedCandidate === false)).toBe(true);
  });

  it("ignores hidden placeholder text when classifying dynamic shell pages", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy,
      requestedUrl: "https://www.example.edu/library.htm",
      finalUrl: "https://www.example.edu/library.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T08:38:00.000Z",
      html: load(SAMPLE_DYNAMIC_SHELL_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012b",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/training/undergraduate.htm",
      finalUrl: "https://www.example.edu/training/undergraduate.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:01:00.000Z",
      html: load(SAMPLE_STRUCTURAL_SHELL_PAGE_HTML),
    });

    expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
  });

  it("classifies image-only body shells as structural shell pages", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012c",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/overview/dean.htm",
      finalUrl: "https://www.example.edu/overview/dean.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:02:00.000Z",
      html: load(SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML),
    });

    expect(pageArtifacts.pageManifest.mainContentBlockCount).toBe(0);
    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
  });

  it("classifies repeated-navigation zero-text shells as structural shell pages", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012d",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/sport/index.htm",
      finalUrl: "https://www.example.edu/sport/index.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:04:00.000Z",
      html: load(SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
    expect(pageArtifacts.providerExtraction.pageSignals.repeatedNonMainBlockCount).toBeGreaterThanOrEqual(40);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
  });

  it("keeps dated link listings with gallery-like titles out of gallery_page", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012e",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/party/branch-highlights.htm",
      finalUrl: "https://www.example.edu/party/branch-highlights.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:05:00.000Z",
      html: load(SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(4);
    expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBeGreaterThanOrEqual(4);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("treats callboard-style central publication lists as main-content listings", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012f",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/zxgk.htm",
      finalUrl: "https://www.example.edu/zxgk.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_CALLBOARD_LISTING_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T18:20:00.000Z",
      html: load(SAMPLE_CALLBOARD_LISTING_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.providerExtraction.pageSignals.mainContentCharacterCount).toBeGreaterThanOrEqual(24);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("does not treat position__content roster sections as navigation boilerplate", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012g",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/xygk/dw2020.htm",
      finalUrl: "https://www.example.edu/xygk/dw2020.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_POSITION_CONTENT_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T23:40:00.000Z",
      html: load(SAMPLE_POSITION_CONTENT_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012h",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/szdw.htm",
      finalUrl: "https://www.example.edu/szdw.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_ROSTER_DIRECTORY_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-30T12:10:00.000Z",
      html: load(SAMPLE_ROSTER_DIRECTORY_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(2);
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
  });

  it("classifies dense direct roster pages on content sites as directory pages instead of generic listing pages", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012h_dense",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/szdw1.htm",
      finalUrl: "https://www.example.edu/szdw1.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-02T12:16:00.000Z",
      html: load(SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(12);
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBe(0);
    expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBe(0);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
  });

  it("classifies heading-only organization pages on content sites as directory pages instead of generic content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_012i",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/jgsz.htm",
      finalUrl: "https://www.example.edu/jgsz.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-30T12:11:00.000Z",
      html: load(SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainHeadingCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBe(0);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("directory_page");
  });

  it("demotes xiaoyou-style fixed sidebar contact widgets out of main content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/alumni.htm",
      finalUrl: "https://www.example.edu/alumni.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_XIAOYOU_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:00:00.000Z",
      html: load(SAMPLE_XIAOYOU_HOME_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013a",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/alumni-live.htm",
      finalUrl: "https://www.example.edu/alumni-live.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-04-01T08:00:00.000Z",
      html: load(SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013b",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/kxyj.htm",
      finalUrl: "https://www.example.edu/kxyj.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-30T12:18:00.000Z",
      html: load(SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML),
    });

    expect(
      pageArtifacts.contentBlocks.some(
        (item) =>
          item.blockRole === "link" &&
          item.textNormalized === "手机版" &&
          item.isMainContent,
      ),
    ).toBe(false);
    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(true);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("structural_shell_page");
  });

  it("classifies single-entry dated link lists as listing pages instead of generic content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013c",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/jyjx/ssspy.htm",
      finalUrl: "https://www.example.edu/jyjx/ssspy.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-30T12:22:00.000Z",
      html: load(SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.mainListItemCount).toBeGreaterThanOrEqual(1);
    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(1);
    expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBeGreaterThanOrEqual(1);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("treats onclick-driven news cards as main-content listing links", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013d",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/",
      finalUrl: "https://www.example.edu/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-31T10:00:00.000Z",
      html: load(SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML),
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
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013e",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/rcpy.htm",
      finalUrl: "https://www.example.edu/rcpy.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-31T16:00:00.000Z",
      html: load(SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
    expect(pageArtifacts.providerExtraction.pageSignals.mainParagraphCount).toBeGreaterThanOrEqual(2);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("article_detail");
  });

  it("recovers panel-style card listings instead of classifying the page as a dynamic shell", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013f",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/sport/index.htm",
      finalUrl: "https://www.example.edu/sport/index.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-31T16:01:00.000Z",
      html: load(SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("recovers sport-homepage card clusters into listing signals instead of leaving the page as a shell", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_013g",
    });
    const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(hostPolicy).not.toBeNull();
    if (!hostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...hostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/sport/",
      finalUrl: "https://www.example.edu/sport/",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-31T17:20:00.000Z",
      html: load(SAMPLE_SPORT_CARD_HOME_PAGE_HTML),
    });

    expect(pageArtifacts.providerExtraction.pageSignals.zeroMainContent).toBe(false);
    expect(pageArtifacts.providerExtraction.pageSignals.mainLinkCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.providerExtraction.pageSignals.dateLikeMainBlockCount).toBeGreaterThanOrEqual(3);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("listing_page");
  });

  it("extracts xiaoyou-style listing tables via content links instead of a giant main-content table", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_014",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/xwdt/xyhdt.htm",
      finalUrl: "https://www.example.edu/xwdt/xyhdt.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_XIAOYOU_LIST_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "navigation",
      discoveredFromUrl: "https://www.example.edu/xwdt.htm",
      fetchedAt: "2026-03-29T09:01:00.000Z",
      html: load(SAMPLE_XIAOYOU_LIST_PAGE_HTML),
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

  it("keeps disclosure-style data tables as main content when they are not listing tables", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_015",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/xxgk.htm",
      finalUrl: "https://www.example.edu/xxgk.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_DISCLOSURE_TABLE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:02:00.000Z",
      html: load(SAMPLE_DISCLOSURE_TABLE_PAGE_HTML),
    });

    const tableBlock = pageArtifacts.contentBlocks.find(
      (item) =>
        item.blockRole === "table" &&
        (item.textNormalized ?? "").includes("招生政策") &&
        (item.textNormalized ?? "").includes("学位授予办法"),
    );

    expect(tableBlock?.isMainContent).toBe(true);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("data_table_page");
    expect(pageArtifacts.providerExtraction.pageSignals.listingTableCount).toBe(0);
  });

  it("demotes gallery-style layout tables while keeping image-card links as main content", () => {
    const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
    if (!buildCollectedPageArtifacts) {
      return;
    }

    const { configRoot } = writeTestConfigRoot();
    const bundle = loadOfficialWebConfig("campus_public", { configRoot });
    const plan = buildOfficialWebCrawlPlan("campus_public", {
      configRoot,
      crawlRunId: "owrun_test_016",
    });
    const directoryHostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

    expect(directoryHostPolicy).not.toBeNull();
    if (!directoryHostPolicy) {
      return;
    }

    const pageArtifacts = buildCollectedPageArtifacts({
      bundle,
      plan,
      hostPolicy: {
        ...directoryHostPolicy,
        publicKind: "content_site",
      },
      requestedUrl: "https://www.example.edu/gallery.htm",
      finalUrl: "https://www.example.edu/gallery.htm",
      declaredCanonicalUrl: null,
      responseBody: SAMPLE_GALLERY_TABLE_PAGE_HTML,
      responseHeaders: {
        "content-type": "text/html; charset=utf-8",
      },
      httpStatus: 200,
      contentType: "text/html",
      discoveryMethod: "seed",
      discoveredFromUrl: null,
      fetchedAt: "2026-03-29T09:03:00.000Z",
      html: load(SAMPLE_GALLERY_TABLE_PAGE_HTML),
    });

    const mainTables = pageArtifacts.contentBlocks.filter(
      (item) => item.blockRole === "table" && item.isMainContent,
    );
    const contentLinks = pageArtifacts.contentBlocks.filter(
      (item) => item.blockRole === "link" && item.isMainContent,
    );

    expect(mainTables).toHaveLength(0);
    expect(pageArtifacts.pageManifest.pageFamily).toBe("gallery_page");
    expect(pageArtifacts.providerExtraction.pageSignals.galleryTableCount).toBeGreaterThanOrEqual(1);
    expect(contentLinks.map((item) => item.textNormalized)).toEqual(
      expect.arrayContaining([
        "李剑老师团队在少数民族地区调研",
        "崔玲玲老师在做田野调查",
      ]),
    );
  });
});
