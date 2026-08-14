import { describe, expect, it } from "vitest";

import { normalizeNoticeContent } from "../src/content.ts";

describe("normalizeNoticeContent", () => {
	it("sanitizes markup, derives text, and rewrites portal images", () => {
		const result = normalizeNoticeContent({
			html: '<div class="x"><script>alert(1)</script><p id="a" onclick="x()">第一段<br>下一行</p><img src="http://portal.example.edu/a.png"><a href="javascript:x()">链接</a></div>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<p>第一段<br>下一行</p><img src="notice-asset:image:0" alt="">链接',
		);
		expect(result.contentText).toBe("第一段\n下一行\n链接");
		expect(result.images).toEqual([
			{
				normalizedUrl: "https://portal.example.edu/a.png",
				ordinal: 0,
				sourceOrdinal: 0,
				sourceUrl: "http://portal.example.edu/a.png",
			},
		]);
	});

	it("drops non-portal images and preserves safe links", () => {
		const result = normalizeNoticeContent({
			html: '<img src="https://cdn.example/a.png"><a href="https://example.com/a">外链</a>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<a href="https://example.com/a" rel="noopener noreferrer">外链</a>',
		);
		expect(result.images).toEqual([]);
	});

	it("removes editor-only non-breaking-space alignment", () => {
		const result = normalizeNoticeContent({
			html: "<p>&nbsp; &nbsp; &nbsp;党委保卫部、保卫处</p><p>&nbsp; &nbsp; 2026年8月3日</p>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe("<p>党委保卫部、保卫处</p><p>2026年8月3日</p>");
		expect(result.contentText).toBe("党委保卫部、保卫处\n2026年8月3日");
	});

	it("removes empty blocks, a repeated title, and invalid link wrappers", () => {
		const result = normalizeNoticeContent({
			html: '<p><span>&nbsp;</span><br></p><p><strong>测试通知</strong></p><p>正文<a href="">空链接</a><a href="file:///D:/附件.doc">本机文件</a></p><p><br></p>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe("<p>正文空链接本机文件</p>");
		expect(result.contentText).toBe("正文空链接本机文件");
	});

	it("converts source presentation into the bounded semantic contract", () => {
		const result = normalizeNoticeContent({
			html: '<h2 style="text-align:center">章节</h2><p style="text-indent:43px;text-align:justify"><span style="font-weight:bold;text-decoration:underline;color:rgb(255,0,0);background:rgb(255,255,0)">重点</span></p><p style="text-align:right;text-indent:43px">落款</p><p style="text-indent:363px">部门</p>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<h3 data-align="center">章节</h3><p data-align="justify" data-indent="true"><mark><u><strong data-emphasis="alert">重点</strong></u></mark></p><p data-align="end">落款</p><p data-align="end">部门</p>',
		);
	});

	it("preserves table headers and bounded cell spans", () => {
		const result = normalizeNoticeContent({
			html: '<table><tbody><tr class="firstRow"><td colspan="2">项目</td></tr><tr><td rowspan="4"><p><br></p>团队</td><td colspan="101">要求</td></tr></tbody></table>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<table><tbody><tr><th colspan="2" scope="col">项目</th></tr><tr><td rowspan="4">团队</td><td>要求</td></tr></tbody></table>',
		);
	});

	it("drops editor placeholders without losing source image ordinals", () => {
		const result = normalizeNoticeContent({
			html: '<p><img src="/images/one.png" alt="image.png"><img src="/static/index/UEditor/themes/default/images/spacer.gif"><img src="/images/two.png" alt="校园地图.png"></p>',
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<p><img src="notice-asset:image:0" alt=""><img src="notice-asset:image:1" alt="校园地图.png"></p>',
		);
		expect(result.images).toEqual([
			{
				normalizedUrl: "https://portal.example.edu/images/one.png",
				ordinal: 0,
				sourceOrdinal: 0,
				sourceUrl: "/images/one.png",
			},
			{
				normalizedUrl: "https://portal.example.edu/images/two.png",
				ordinal: 1,
				sourceOrdinal: 2,
				sourceUrl: "/images/two.png",
			},
		]);
	});
});
