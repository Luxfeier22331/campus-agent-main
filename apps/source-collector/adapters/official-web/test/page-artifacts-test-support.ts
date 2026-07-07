import { load } from "cheerio";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
} from "../src/core/index.ts";
import type { CollectedPageArtifact } from "../src/page-artifacts";
import * as pageArtifactsModule from "../src/page-artifacts";

export * from "./test-support";

import { writeTestConfigRoot } from "./test-support";

type BuildCollectedPageArtifactsFn = typeof pageArtifactsModule.buildCollectedPageArtifacts;
type DiscoveryMethod = Parameters<NonNullable<BuildCollectedPageArtifactsFn>>[0]["discoveryMethod"];
type ResponseHeaders = Parameters<NonNullable<BuildCollectedPageArtifactsFn>>[0]["responseHeaders"];
type TestPublicKind = NonNullable<ReturnType<typeof findOfficialWebHostPolicy>>["publicKind"];

export interface BuildPageArtifactsForTestInput {
	contentType?: string;
	crawlRunId: string;
	declaredCanonicalUrl?: string | null;
	discoveredFromUrl?: string | null;
	discoveryMethod?: DiscoveryMethod;
	fetchedAt: string;
	finalUrl: string;
	host?: string;
	html?: ReturnType<typeof load>;
	httpStatus?: number;
	publicKind?: TestPublicKind;
	requestedUrl: string;
	responseBody: string;
	responseHeaders?: ResponseHeaders;
}

export function getBuildCollectedPageArtifacts(): NonNullable<BuildCollectedPageArtifactsFn> {
	const buildCollectedPageArtifacts = pageArtifactsModule.buildCollectedPageArtifacts;
	if (typeof buildCollectedPageArtifacts !== "function") {
		throw new TypeError("buildCollectedPageArtifacts must be a function");
	}
	return buildCollectedPageArtifacts as NonNullable<BuildCollectedPageArtifactsFn>;
}

function resolveHostPolicy(input: {
	bundle: ReturnType<typeof loadOfficialWebConfig>;
	host: string;
	publicKind?: TestPublicKind;
}) {
	const hostPolicy = findOfficialWebHostPolicy(input.bundle, input.host);
	if (!hostPolicy) {
		throw new Error(`Missing host policy for ${input.host}`);
	}

	if (!input.publicKind) {
		return hostPolicy;
	}

	return {
		...hostPolicy,
		publicKind: input.publicKind,
	};
}

export function buildPageArtifactsForTest(
	input: BuildPageArtifactsForTestInput,
): CollectedPageArtifact {
	const { configRoot } = writeTestConfigRoot();
	const bundle = loadOfficialWebConfig("campus_public", { configRoot });
	const plan = buildOfficialWebCrawlPlan("campus_public", {
		configRoot,
		crawlRunId: input.crawlRunId,
	});
	const host = input.host ?? "www.example.edu";
	const hostPolicy = resolveHostPolicy({
		bundle,
		host,
		publicKind: input.publicKind,
	});
	const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();

	return buildCollectedPageArtifacts({
		bundle,
		plan,
		hostPolicy,
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		declaredCanonicalUrl: input.declaredCanonicalUrl ?? null,
		responseBody: input.responseBody,
		responseHeaders: input.responseHeaders ?? {
			"content-type": "text/html; charset=utf-8",
		},
		httpStatus: input.httpStatus ?? 200,
		contentType: input.contentType ?? "text/html",
		discoveryMethod: input.discoveryMethod ?? "seed",
		discoveredFromUrl: input.discoveredFromUrl ?? null,
		fetchedAt: input.fetchedAt,
		html: input.html ?? load(input.responseBody),
	});
}

export function buildDirectorySiteArtifactsForTest(
	input: Omit<BuildPageArtifactsForTestInput, "publicKind">,
): CollectedPageArtifact {
	return buildPageArtifactsForTest(input);
}

export function buildContentSiteArtifactsForTest(
	input: Omit<BuildPageArtifactsForTestInput, "publicKind">,
): CollectedPageArtifact {
	return buildPageArtifactsForTest({
		...input,
		publicKind: "content_site",
	});
}

export const SAMPLE_DISCLOSURE_TABLE_PAGE_HTML = `
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

export const SAMPLE_GALLERY_TABLE_PAGE_HTML = `
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

export const SAMPLE_REPEATED_NAV_STRUCTURAL_SHELL_PAGE_HTML = `
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

export const SAMPLE_NEWS_PORTAL_AGGREGATE_PAGE_HTML = `
<!doctype html>
<html lang="zh-cn">
  <head>
    <title>示例大学新闻网</title>
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
        <p>从北京到边疆，从课堂到田野，一场关于“铸牢”教育的系统探索，正在示例大学稳步开展。</p>
        <div class="tabs">
          <span>教学科研</span>
          <span>校园经纬</span>
          <span>全球合作</span>
        </div>
        <div class="card">
          <h3><a href="/info/1.htm">示例大学党委举办树立和践行正确政绩观学习教育读书班</a></h3>
        </div>
        <div class="card">
          <h3><a href="/info/2.htm">示例大学唐鑫团队在红外高光谱成像系统研究获重大突破</a></h3>
        </div>
        <div class="card">
          <h3><a href="/info/3.htm">《学习时报》孔新峰：政德何以重要</a></h3>
          <p>
            新闻网讯 3月23日，《学习时报》刊发示例大学马克思主义学院党委书记、院长孔新峰教授撰写的理论文章《政德何以重要》，文章指出：新时代新征程对干部治理能力提出更高要求，政德建设成为干部队伍建设的关键抓手。政德作为党员干部从政履职的根本道德准则，是中华传统政治文明一脉相承的精神内核，唯有筑牢政德底...
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

export const SAMPLE_INFORMATION_DISCLOSURE_REGULATION_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>示例大学信息公开实施细则 - 示例大学信息公开</title>
  </head>
  <body>
    <main>
      <h1>示例大学信息公开实施细则</h1>
      <p>
        第一条 为进一步推进依法治校，完善民主管理和民主监督的工作机制，保障学校师生员工和公民、
        法人和其他组织依法获取学校信息，结合学校实际，制定本实施细则。
      </p>
      <p>
        第二条 学校信息公开坚持依法公开、及时准确、便民服务和促进学校事业发展的原则。信息公开
        办公室设在学校办公室，联系电话：010-68933186，电子邮箱：disclosure@example.edu。
      </p>
    </main>
  </body>
</html>
`.trim();

export const SAMPLE_MOBILE_LINK_STRUCTURAL_SHELL_PAGE_HTML = `
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

export const SAMPLE_SINGLE_ENTRY_DATED_LISTING_PAGE_HTML = `
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

export const SAMPLE_GALLERY_KEYWORD_LISTING_PAGE_HTML = `
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

export const SAMPLE_MIXED_AGGREGATE_CARD_LISTING_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>欢迎光临示例大学示例历史学院网站</title>
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
                <p class="summary">示例历史学院教师裴艾琳的学术专著于2025年10月由上海古籍出版社出版发行。</p>
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

export const SAMPLE_CALLBOARD_LISTING_PAGE_HTML = `
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

export const SAMPLE_POSITION_CONTENT_PAGE_HTML = `
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
