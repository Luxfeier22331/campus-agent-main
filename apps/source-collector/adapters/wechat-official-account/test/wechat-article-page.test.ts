import { describe, expect, it, vi } from "vitest";

import {
	fetchWeChatOfficialAccountArticlePage,
	parseWeChatOfficialAccountArticlePageHtml,
} from "../src/wechat-article-page.ts";

describe("WeChat article page parsing", () => {
	it("extracts article body structure from a canonical mp.weixin page", () => {
		const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="示例出行快讯｜加车！实践周班车合集来啦～" />
    <meta property="og:description" content="有乘车需求的同学注意啦&#10;4月27日—5月5日期间&#10;通勤车辆有所调整" />
    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <h1 id="activity-name">示例出行快讯｜加车！实践周班车合集来啦～</h1>
    <div id="js_content">
      <section><p>有乘车需求的同学注意啦</p></section>
      <section><p>4月27日—5月5日期间通勤车辆有所调整</p></section>
      <section><p>🚌通勤班车运营安排</p></section>
      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg" />
      <img data-src="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg" />
    </div>
    <script>
      window.ct = 1777166101;
    </script>
  </body>
</html>`;

		const parsed = parseWeChatOfficialAccountArticlePageHtml({
			articleUrl: "https://mp.weixin.qq.com/s/synthetic-schedule-article",
			html,
		});

		expect(parsed.pageKind).toBe("article");
		expect(parsed.title).toBe("示例出行快讯｜加车！实践周班车合集来啦～");
		expect(parsed.summary).toBe("有乘车需求的同学注意啦\n4月27日—5月5日期间\n通勤车辆有所调整");
		expect(parsed.publishTime).toBe("2026-04-26T01:15:01.000Z");
		expect(parsed.publishTimeSource).toBe("window.ct");
		expect(parsed.coverImageUrl).toBe(
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
		);
		expect(parsed.bodyBlocks).toEqual([
			"有乘车需求的同学注意啦",
			"4月27日—5月5日期间通勤车辆有所调整",
			"🚌通勤班车运营安排",
		]);
		expect(parsed.inlineImageUrls).toEqual([
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
		]);
	});

	it("classifies WeChat verification pages as fail-closed non-article captures", () => {
		const html = `<!doctype html>
<html>
  <body>
    <div id="wappoc_appmsgcaptcha">环境异常</div>
    <button>去验证</button>
  </body>
</html>`;

		const parsed = parseWeChatOfficialAccountArticlePageHtml({
			articleUrl: "https://mp.weixin.qq.com/s/verify",
			html,
		});

		expect(parsed.pageKind).toBe("verification");
		expect(parsed.bodyBlocks).toEqual([]);
		expect(parsed.inlineImageUrls).toEqual([]);
	});

	it("extracts body and inline images from modern mp.weixin shell data", () => {
		const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="示例出行快讯｜加车！实践周班车合集来啦～" />
    <meta property="og:description" content="有乘车需求的同学注意啦\\x0a详情可见上图2" />
    <meta property="og:image" content="http://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <script>
      function JsDecode(value) { return value; }
      window.cgiDataNew = {
        title: JsDecode('示例出行快讯｜加车！实践周班车合集来啦～'),
        desc: JsDecode('有乘车需求的同学注意啦\\x0a详情可见上图2'),
        content_noencode: JsDecode('有乘车需求的同学注意啦\\x0a4月27日—5月5日期间\\x0a详情可见上图2'),
        create_time: JsDecode('2026-04-26 09:15'),
        cdn_url: JsDecode('http://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg'),
        picture_page_info_list: [
          { cdn_url: JsDecode('https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/schedule-1/0?wx_fmt=jpeg') },
          { cdn_url: JsDecode('http://mmbiz.qpic.cn/sz_mmbiz_jpg/example/schedule-2/0?wx_fmt=jpeg') },
        ],
        ori_create_time: '1777166101' * 1,
      };
    </script>
  </body>
</html>`;

		const parsed = parseWeChatOfficialAccountArticlePageHtml({
			articleUrl: "https://mp.weixin.qq.com/s/synthetic-schedule-article",
			html,
		});

		expect(parsed.pageKind).toBe("article");
		expect(parsed.title).toBe("示例出行快讯｜加车！实践周班车合集来啦～");
		expect(parsed.summary).toBe("有乘车需求的同学注意啦\n详情可见上图2");
		expect(parsed.publishTime).toBe("2026-04-26T01:15:01.000Z");
		expect(parsed.publishTimeSource).toBe("ori_create_time");
		expect(parsed.coverImageUrl).toBe(
			"http://mmbiz.qpic.cn/sz_mmbiz_jpg/example/cover/0?wx_fmt=jpeg",
		);
		expect(parsed.bodyBlocks).toEqual([
			"有乘车需求的同学注意啦",
			"4月27日—5月5日期间",
			"详情可见上图2",
		]);
		expect(parsed.inlineImageUrls).toEqual([
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/schedule-1/0?wx_fmt=jpeg",
			"http://mmbiz.qpic.cn/sz_mmbiz_jpg/example/schedule-2/0?wx_fmt=jpeg",
		]);
	});

	it("does not classify metadata-only modern mp.weixin shell data as an article", () => {
		const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="示例出行快讯｜加车！实践周班车合集来啦～" />
  </head>
  <body>
    <script>
      function JsDecode(value) { return value; }
      window.cgiDataNew = {
        title: JsDecode('示例出行快讯｜加车！实践周班车合集来啦～'),
      };
    </script>
  </body>
</html>`;

		const parsed = parseWeChatOfficialAccountArticlePageHtml({
			articleUrl: "https://mp.weixin.qq.com/s/metadata-only",
			html,
		});

		expect(parsed.pageKind).toBe("non_article");
		expect(parsed.bodyBlocks).toEqual([]);
		expect(parsed.inlineImageUrls).toEqual([]);
	});

	it("fetches mp.weixin pages with browser-profile headers and preserves page classification", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				`<!doctype html>
<html>
  <body>
    <div id="wappoc_appmsgcaptcha">环境异常</div>
    <button>去验证</button>
  </body>
</html>`,
				{
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 200,
				},
			),
		);

		const page = await fetchWeChatOfficialAccountArticlePage({
			articleUrl: "https://mp.weixin.qq.com/s/verify",
			fetchImplementation,
			now: () => new Date("2026-04-28T00:00:00.000Z"),
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://mp.weixin.qq.com/s/verify",
			expect.objectContaining({
				headers: expect.objectContaining({
					accept: "text/html,application/xhtml+xml",
					"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
					"user-agent": expect.stringContaining("Windows NT"),
				}),
				redirect: "follow",
			}),
		);
		expect(page.pageKind).toBe("verification");
		expect(page.rawHtml).toContain("环境异常");
		expect(page.fetchedAt).toBe("2026-04-28T00:00:00.000Z");
	});
});
