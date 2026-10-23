import { describe, expect, it } from "vitest";
import { prepareNoticeContentHtml } from "../src/features/notices/content-html";

const image = {
	byteSize: "256",
	contentType: "image/png",
	name: null,
	ordinal: 0,
	url: "/api/notices/358159/images/0",
};

describe("notice content HTML boundary", () => {
	it("only accepts image routes for the selected audience", () => {
		const html = '<img src="notice-asset:image:0" alt="">';
		const opsImage = { ordinal: 0, url: "/api/ops/notices/358159/images/0" };
		expect(prepareNoticeContentHtml(html, [opsImage], { audience: "ops" }).status).toBe("ready");
		expect(prepareNoticeContentHtml(html, [opsImage]).status).toBe("invalid");
		expect(prepareNoticeContentHtml(html, [image], { audience: "ops" }).status).toBe("invalid");
	});
	it("accepts the published allowlist and rewrites image placeholders", () => {
		expect(
			prepareNoticeContentHtml(
				'<h3 data-align="center">开放安排</h3><p data-align="justify" data-indent="true">正文<mark><u><strong data-emphasis="alert">重点</strong></u></mark></p><img src="notice-asset:image:0" alt="场地安排"><a href="https://example.edu/a" rel="noopener noreferrer">来源</a>',
				[image],
			),
		).toEqual({
			html: '<h3 data-align="center">开放安排</h3><p data-align="justify" data-indent="true">正文<mark><u><strong data-emphasis="alert">重点</strong></u></mark></p><img src="/api/notices/358159/images/0" alt="场地安排"><a href="https://example.edu/a" rel="noopener noreferrer">来源</a>',
			status: "ready",
		});
	});

	it("accepts bounded table structure attributes", () => {
		expect(
			prepareNoticeContentHtml(
				'<table><tbody><tr><th colspan="2" scope="col">项目</th></tr><tr><td rowspan="4" data-align="center">团队</td></tr></tbody></table>',
				[],
			),
		).toMatchObject({ status: "ready" });
	});

	it.each([
		["script tag", "<script>alert(1)</script>"],
		["event attribute", '<p onclick="alert(1)">正文</p>'],
		["unknown image", '<img src="notice-asset:image:1" alt="">'],
		["direct image URL", '<img src="/api/notices/358159/images/0" alt="">'],
		["unsafe link", '<a href="javascript:alert(1)">链接</a>'],
		["removed heading level", "<h2>正文标题</h2>"],
		["unknown semantic attribute", '<p data-align="left">正文</p>'],
		["out-of-range span", '<table><tbody><tr><td rowspan="101">正文</td></tr></tbody></table>'],
	])("rejects %s instead of injecting partial content", (_label, html) => {
		expect(prepareNoticeContentHtml(html, [image])).toEqual({ status: "invalid" });
	});

	it("reports an explicit empty state", () => {
		expect(prepareNoticeContentHtml(null, [])).toEqual({ status: "empty" });
	});
});
