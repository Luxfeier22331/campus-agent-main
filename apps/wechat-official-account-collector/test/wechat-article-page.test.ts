import { describe, expect, it } from "vitest";

import { parseWeChatOfficialAccountArticlePageHtml } from "../src/wechat-article-page.ts";

describe("WeChat article page parsing", () => {
	it("extracts article body structure from a canonical mp.weixin page", () => {
		const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="MUC出行快讯｜加车！实践周班车合集来啦～" />
    <meta property="og:description" content="有乘车需求的MUCer注意啦&#10;4月27日—5月5日期间&#10;通勤车辆有所调整" />
    <meta property="og:image" content="https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg" />
  </head>
  <body>
    <h1 id="activity-name">MUC出行快讯｜加车！实践周班车合集来啦～</h1>
    <div id="js_content">
      <section><p>有乘车需求的MUCer注意啦</p></section>
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
			articleUrl: "https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw",
			html,
		});

		expect(parsed.title).toBe("MUC出行快讯｜加车！实践周班车合集来啦～");
		expect(parsed.summary).toBe("有乘车需求的MUCer注意啦\n4月27日—5月5日期间\n通勤车辆有所调整");
		expect(parsed.publishTime).toBe("2026-04-26T01:15:01.000Z");
		expect(parsed.publishTimeSource).toBe("window.ct");
		expect(parsed.coverImageUrl).toBe(
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
		);
		expect(parsed.bodyBlocks).toEqual([
			"有乘车需求的MUCer注意啦",
			"4月27日—5月5日期间通勤车辆有所调整",
			"🚌通勤班车运营安排",
		]);
		expect(parsed.inlineImageUrls).toEqual([
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
		]);
	});
});
