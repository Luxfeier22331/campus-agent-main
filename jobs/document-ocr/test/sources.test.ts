import { expect, it } from "vitest";
import { noticeInputs } from "../src/sources.ts";

it("selects source images and PDF attachments without requiring publication/classification", () => {
	expect(
		noticeInputs(
			"123",
			{
				notice_id: 123,
				is_external: false,
				notice_content_html: '<p><img src="a.jpg"><img src="b.png"></p>',
				attachments: [{ suffix: "xlsx" }, { suffix: "pdf" }],
			},
			"portal.example",
		),
	).toEqual([
		{
			kind: "source",
			noticeId: "123",
			key: "internal_portal/notices/123/images/0",
			contentType: "image/*",
		},
		{
			kind: "source",
			noticeId: "123",
			key: "internal_portal/notices/123/images/1",
			contentType: "image/*",
		},
		{
			kind: "source",
			noticeId: "123",
			key: "internal_portal/notices/123/attachments/1",
			contentType: "application/pdf",
		},
	]);
});
