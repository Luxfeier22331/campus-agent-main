import type { OcrInput, OcrObjects } from "@campus-agent/document-ocr";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { selectNoticeInputs } from "../src/sources.ts";

it("selects only body images without requiring publication/classification", async () => {
	const query = vi.fn().mockResolvedValue({
		rows: [{ id: "123" }],
	});
	const objects: OcrObjects = {
		getSource: vi.fn().mockResolvedValue(
			new TextEncoder().encode(
				JSON.stringify({
					notice_id: 123,
					is_external: false,
					notice_content_html:
						'<p><img src="a.jpg"><img src="/static/index/UEditor/themes/default/images/spacer.gif"><img src="b.png"></p>',
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
			resource: { kind: "image", ordinal: 0, displayOrdinal: 0 },
		},
		{
			kind: "source",
			noticeId: "123",
			key: "internal_portal/notices/123/images/2",
			contentType: "image/*",
			resource: { kind: "image", ordinal: 2, displayOrdinal: 1 },
		},
	]);
	expect(objects.getSource).toHaveBeenCalledWith("internal_portal/notices/123.json");
	expect(query).toHaveBeenCalledWith(expect.any(String), ["123"]);
});

it("scans all internal notices, without a title restriction", async () => {
	const query = vi.fn().mockResolvedValue({ rows: [] });
	for await (const _input of selectNoticeInputs({ query } as unknown as Pool, {} as OcrObjects)) {
		/* No rows. */
	}
	expect(query).toHaveBeenCalledWith(expect.stringContaining("where not is_external"), [null]);
	expect(query.mock.calls[0]?.[0]).not.toMatch(/title|is_published|category/);
});

it("reads the current snapshot and maps hashed resources to source and display ordinals", async () => {
	const sourceKey = `internal_portal/notices/123/sources/${"a".repeat(64)}.json`;
	const imageKey = `internal_portal/resources/sha256/${"b".repeat(64)}`;
	const query = vi.fn().mockResolvedValue({ rows: [{ id: "123", source_ref: sourceKey }] });
	const objects = {
		getSource: vi.fn().mockResolvedValue(
			Buffer.from(
				JSON.stringify({
					notice_id: 123,
					is_external: false,
					notice_content_html:
						'<img src="/static/index/UEditor/themes/default/images/spacer.gif"><img src="/a.png">',
					attachments: [],
					resources: [{ kind: "images", ordinal: 1, object_key: imageKey }],
				}),
			),
		),
	} as unknown as OcrObjects;
	const inputs: OcrInput[] = [];
	for await (const input of selectNoticeInputs({ query } as unknown as Pool, objects)) {
		inputs.push(input);
	}
	expect(objects.getSource).toHaveBeenCalledWith(sourceKey);
	expect(inputs).toEqual([
		{
			kind: "source",
			noticeId: "123",
			key: imageKey,
			contentType: "image/*",
			resource: { kind: "image", ordinal: 1, displayOrdinal: 0 },
		},
	]);
});
