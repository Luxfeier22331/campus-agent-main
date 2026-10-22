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

	it("drops images the portal reported missing and keeps display ordinals contiguous", () => {
		const result = normalizeNoticeContent({
			html: '<p>正文</p><img src="/a.png"><img src="/b.png"><img src="/c.png">',
			missingImageSourceOrdinals: new Set([1]),
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe(
			'<p>正文</p><img src="notice-asset:image:0" alt=""><img src="notice-asset:image:1" alt="">',
		);
		expect(result.images.map(({ ordinal, sourceOrdinal }) => [ordinal, sourceOrdinal])).toEqual([
			[0, 0],
			[1, 2],
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

	it("removes a repeated title before a line break without dropping the following text", () => {
		const result = normalizeNoticeContent({
			html: "<p><strong>测试通知</strong><br>正文</p>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentHtml).toBe("<p>正文</p>");
		expect(result.contentText).toBe("正文");
	});

	it("applies audited text corrections without changing unrelated words", () => {
		const result = normalizeNoticeContent({
			html: "<p>将统计表干3月5日前提交，登陆教务系统。</p><p>气模馆举办 Al+信息可视化设计活动。</p><p>登陆月球。</p>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentText).toBe(
			"将统计表于3月5日前提交，登录教务系统。\n" +
				"气膜馆举办 AI+信息可视化设计活动。\n" +
				"登陆月球。",
		);
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

	it("serializes logical table rows with hierarchical column labels", () => {
		const result = normalizeNoticeContent({
			html: [
				"<table>",
				"<thead><tr><th rowspan='2'>类别</th><th colspan='2'>时间</th></tr>",
				"<tr><th>开始</th><th>结束</th></tr></thead>",
				"<tbody><tr><td>讲座</td><td>9:00</td><td>10:00</td></tr>",
				"<tr><td>会议</td><td>14:00</td><td>16:00</td></tr></tbody>",
				"</table>",
			].join(""),
			portalHost: "portal.example.edu",
			title: "测试通知",
		});

		expect(result.contentText).toBe(
			"类别：讲座；时间 / 开始：9:00；时间 / 结束：10:00\n" +
				"类别：会议；时间 / 开始：14:00；时间 / 结束：16:00",
		);
	});

	it("keeps repeated grouped table headers attached to their own rows", () => {
		const result = normalizeNoticeContent({
			html: [
				"<table>",
				"<tr class='firstRow'><td colspan='4'>2022-2023年度</td></tr>",
				"<tr><td>项目</td><td>测试时间</td><td>测试地点</td><td>测试对象</td></tr>",
				"<tr><td>室外项目</td><td>5月9日</td><td>室外田径场</td><td rowspan='2'>22级毕业生</td></tr>",
				"<tr><td>室内项目</td><td>5月12日</td><td>体质健康测试中心</td></tr>",
				"<tr><td colspan='4'>2023-2024年度</td></tr>",
				"<tr><td>项目</td><td>测试时间</td><td>测试地点</td><td>测试对象</td></tr>",
				"<tr><td>室外项目</td><td>6月9日</td><td>室外田径场</td><td rowspan='2'>23级毕业生</td></tr>",
				"<tr><td>室内项目</td><td>6月12日</td><td>体质健康测试中心</td></tr>",
				"</table>",
			].join(""),
			portalHost: "portal.example.edu",
			title: "测试通知",
		});

		expect(result.contentText).toBe(
			"2022-2023年度；项目；测试时间；测试地点；测试对象\n" +
				"2022-2023年度；室外项目；5月9日；室外田径场；22级毕业生\n" +
				"2022-2023年度；室内项目；5月12日；体质健康测试中心；22级毕业生\n" +
				"2023-2024年度；项目；测试时间；测试地点；测试对象\n" +
				"2023-2024年度；室外项目；6月9日；室外田径场；23级毕业生\n" +
				"2023-2024年度；室内项目；6月12日；体质健康测试中心；23级毕业生",
		);
	});

	it("keeps positioned table rows when no explicit header exists", () => {
		const result = normalizeNoticeContent({
			html: "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});

		expect(result.contentText).toBe("A；B\nC；D");
	});

	it("does not infer labels from a first data row marked as table headers", () => {
		const result = normalizeNoticeContent({
			html: "<table><tbody><tr><th scope='col'>外国语学院</th><th scope='col'>郭欣悦</th></tr><tr><td>信息工程学院</td><td>华方源</td></tr></tbody></table>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentText).toBe("外国语学院；郭欣悦\n信息工程学院；华方源");
	});

	it("keeps table cell line breaks inside a positioned row", () => {
		const result = normalizeNoticeContent({
			html: "<table><tr><td rowspan='2'>项目</td><td>第一<br>阶段</td></tr><tr><td>第二阶段</td></tr></table>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});
		expect(result.contentText).toBe("项目；第一 阶段\n项目；第二阶段");
	});

	it("does not turn image alt text into logical table text", () => {
		const result = normalizeNoticeContent({
			html: "<table><tr><th>材料</th><th>说明</th></tr><tr><td><img src='/qr.png' alt='报名二维码'></td><td>扫描填写</td></tr></table>",
			portalHost: "portal.example.edu",
			title: "测试通知",
		});

		expect(result.contentText).toBe("材料；说明\n扫描填写");
		expect(result.contentText).not.toContain("报名二维码");
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
