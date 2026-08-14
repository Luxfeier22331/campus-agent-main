import { describe, expect, it } from "vitest";
import { describeExternalNoticeSource } from "../src/features/notices/external-source";

describe("external notice source labels", () => {
	it.each([
		["https://mp.weixin.qq.com/s/example", "wechat", "微信公众号"],
		["https://www.ccgp.gov.cn/cggg/zygg/example", "procurement", "中国政府采购网"],
		["https://ggzyfw.beijing.gov.cn/example", "procurement", "北京市公共资源交易平台"],
		["https://h.xinhuaxmt.com/example", "media", "新华社"],
		["https://docs.qq.com/doc/example", "document", "腾讯文档"],
	])("identifies %s", (url, kind, label) => {
		expect(describeExternalNoticeSource(url)).toMatchObject({ kind, label });
	});

	it("identifies university sites without inventing department names", () => {
		expect(describeExternalNoticeSource("https://lib.muc.edu.cn/notice/1")).toEqual({
			hostname: "lib.muc.edu.cn",
			kind: "campus",
			label: "校内网站 · lib.muc.edu.cn",
		});
	});

	it("shows an unknown source by its normalized hostname", () => {
		expect(describeExternalNoticeSource("https://WWW.Example.EDU/notice/1")).toEqual({
			hostname: "www.example.edu",
			kind: "website",
			label: "外部网站 · example.edu",
		});
	});
});
