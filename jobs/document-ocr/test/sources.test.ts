import type { OcrInput, OcrObjects } from "@campus-agent/document-ocr";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { selectNoticeInputs, selectUncoveredNoticeInputs } from "../src/sources.ts";

it("selects body images by default without requiring publication/classification", async () => {
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
					resources: [
						{
							kind: "attachments",
							ordinal: 1,
							object_key: "internal_portal/notices/123/attachments/1",
						},
					],
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
		{
			kind: "source",
			noticeId: "123",
			key: "internal_portal/notices/123/attachments/1",
			contentType: "application/pdf",
			resource: { kind: "attachment", ordinal: 1, displayOrdinal: 0 },
		},
	]);
	expect(objects.getSource).toHaveBeenCalledWith("internal_portal/notices/123.json");
	expect(query).toHaveBeenCalledWith(expect.any(String), ["123"]);
});

it("selects only PDF attachments in the explicit PDF pilot mode", async () => {
	const query = vi.fn().mockResolvedValue({ rows: [{ id: "123" }] });
	const objects = {
		getSource: vi.fn().mockResolvedValue(
			Buffer.from(
				JSON.stringify({
					notice_id: 123,
					is_external: false,
					notice_content_html: '<img src="a.jpg">',
					attachments: [{ suffix: "xlsx" }, { suffix: ".PDF" }],
					resources: [
						{ kind: "attachments", ordinal: 0, object_key: "xlsx-key" },
						{ kind: "attachments", ordinal: 1, object_key: "pdf-key" },
					],
				}),
			),
		),
	} as unknown as OcrObjects;
	const inputs: OcrInput[] = [];
	for await (const input of selectNoticeInputs({ query } as unknown as Pool, objects, "123", {
		pdfOnly: true,
	})) {
		inputs.push(input);
	}
	expect(inputs).toEqual([
		{
			kind: "source",
			noticeId: "123",
			key: "pdf-key",
			contentType: "application/pdf",
			resource: { kind: "attachment", ordinal: 1, displayOrdinal: 0 },
		},
	]);
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

it("scheduled discovery yields only uncovered published assets, reading sources of those notices only", async () => {
	const covered = `internal_portal/resources/sha256/${"a".repeat(64)}`;
	const uncovered = `internal_portal/resources/sha256/${"b".repeat(64)}`;
	const pdf = `internal_portal/resources/sha256/${"c".repeat(64)}`;
	const query = vi.fn().mockResolvedValue({
		rows: [{ id: "123", source_ref: "published-ref", keys: [uncovered, pdf] }],
	});
	const objects = {
		getSource: vi.fn().mockResolvedValue(
			Buffer.from(
				JSON.stringify({
					notice_id: 123,
					is_external: false,
					notice_content_html: '<img src="/a.png"><img src="/b.png">',
					attachments: [{ suffix: "pdf" }],
					resources: [
						{ kind: "images", ordinal: 0, object_key: covered },
						{ kind: "images", ordinal: 1, object_key: uncovered },
						{ kind: "attachments", ordinal: 0, object_key: pdf },
					],
				}),
			),
		),
	} as unknown as OcrObjects;
	const since = new Date("2026-09-23T00:00:00Z");
	const inputs: OcrInput[] = [];
	for await (const input of selectUncoveredNoticeInputs({ query } as unknown as Pool, objects, {
		since,
	})) {
		inputs.push(input);
	}
	expect(query).toHaveBeenCalledWith(expect.stringContaining("n.is_published"), [since, false]);
	expect(query.mock.calls[0]?.[0]).toMatch(/not exists[\s\S]*dedup_key/);
	expect(objects.getSource).toHaveBeenCalledWith("published-ref");
	expect(inputs).toEqual([
		{
			kind: "source",
			noticeId: "123",
			key: uncovered,
			contentType: "image/*",
			resource: { kind: "image", ordinal: 1, displayOrdinal: 1 },
		},
		{
			kind: "source",
			noticeId: "123",
			key: pdf,
			contentType: "application/pdf",
			resource: { kind: "attachment", ordinal: 0, displayOrdinal: 0 },
		},
	]);
});
