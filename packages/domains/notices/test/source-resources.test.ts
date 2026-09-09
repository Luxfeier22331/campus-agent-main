import { describe, expect, it } from "vitest";
import { listNoticeSourceResources } from "../src/source-resources.ts";

describe("listNoticeSourceResources", () => {
	it("lists normalized images and all attachment ordinals", () => {
		expect(
			listNoticeSourceResources(
				"123",
				{
					notice_id: 123,
					is_external: false,
					notice_content_html:
						'<p><img src="https://portal.example/a.jpg"><img src="https://portal.example/b.png"></p>',
					attachments: [{ suffix: "xlsx" }, { suffix: ".pdf" }],
				},
				"portal.example",
			),
		).toEqual([
			{
				kind: "image",
				noticeId: "123",
				ordinal: 0,
				sourceKey: "internal_portal/notices/123/images/0",
			},
			{
				kind: "image",
				noticeId: "123",
				ordinal: 1,
				sourceKey: "internal_portal/notices/123/images/1",
			},
			{
				kind: "attachment",
				noticeId: "123",
				ordinal: 0,
				sourceKey: "internal_portal/notices/123/attachments/0",
				suffix: "xlsx",
			},
			{
				kind: "attachment",
				noticeId: "123",
				ordinal: 1,
				sourceKey: "internal_portal/notices/123/attachments/1",
				suffix: ".pdf",
			},
		]);
	});

	it("does not expose external notice resources", () => {
		expect(
			listNoticeSourceResources(
				"123",
				{
					notice_id: 123,
					is_external: true,
					notice_content_html: '<img src="https://portal.example/a.jpg">',
					attachments: [{ suffix: "pdf" }],
				},
				"portal.example",
			),
		).toEqual([]);
	});

	it("rejects a mismatched notice identity", () => {
		expect(() =>
			listNoticeSourceResources(
				"999",
				{
					notice_id: 123,
					is_external: false,
					notice_content_html: null,
					attachments: [],
				},
				"portal.example",
			),
		).toThrow("Notice source identity mismatch");
	});
});
