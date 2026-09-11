import type { OcrInput, OcrObjects } from "@campus-agent/document-ocr";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { selectNoticeInputs } from "../src/sources.ts";

it("selects source images and PDF attachments without requiring publication/classification", async () => {
	const query = vi.fn().mockResolvedValue({
		rows: [{ id: "123" }],
	});
	const objects: OcrObjects = {
		getSource: vi.fn().mockResolvedValue(
			new TextEncoder().encode(
				JSON.stringify({
					notice_id: 123,
					is_external: false,
					notice_content_html: '<p><img src="a.jpg"><img src="b.png"></p>',
					attachments: [{ suffix: "xlsx" }, { suffix: ".PDF" }, { suffix: null }],
				}),
			),
		),
		getDerived: vi.fn(),
		putDerived: vi.fn(),
		deleteDerived: vi.fn(),
		close: vi.fn(),
	};
	const inputs: OcrInput[] = [];
	for await (const input of selectNoticeInputs({ query } as unknown as Pool, objects, "123")) {
		inputs.push(input);
	}
	expect(inputs).toEqual([
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
	expect(objects.getSource).toHaveBeenCalledWith("internal_portal/notices/123.json");
	expect(query).toHaveBeenCalledWith(expect.any(String), ["123"]);
});
