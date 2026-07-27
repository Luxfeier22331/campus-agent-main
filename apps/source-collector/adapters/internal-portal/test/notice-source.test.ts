import { describe, expect, it, vi } from "vitest";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import {
	buildInternalPortalNoticeSource,
	createInternalPortalNoticeSourceStore,
	internalPortalNoticeSourceObjectKey,
} from "../src/notice-source.js";

describe("internal portal notice source", () => {
	it("keeps normalized attachment metadata in portal order including duplicates", () => {
		const source = buildInternalPortalNoticeSource({
			detailInfo: {
				notice_annext: [
					{
						notice_annex_id: " annex-2 ",
						notice_annex_name: " 第二份.pdf ",
						notice_annex_path: " /download/2 ",
						suffix: " pdf ",
						type: " application/pdf ",
					},
					{
						notice_annex_id: " annex-1 ",
						notice_annex_name: " 第一份.pdf ",
						notice_annex_path: " /download/1 ",
						suffix: " pdf ",
						type: " application/pdf ",
					},
					{
						notice_annex_id: " annex-1 ",
						notice_annex_name: " 第一份.pdf ",
						notice_annex_path: " /download/1 ",
						suffix: " pdf ",
						type: " application/pdf ",
					},
				],
				notice_content: " <p>正文</p> ",
				notice_id: 355119,
				notice_release_time: " 2026-07-25 09:00:00 ",
				notice_title: " 示例通知 ",
				notice_type_name: " 办公通知 ",
				organization_name: " 教务处 ",
			},
			noticeId: 355119,
			siteId: "muc_internal_portal",
		});

		expect(source).toMatchObject({
			notice_content: "<p>正文</p>",
			notice_id: 355119,
			notice_release_time: "2026-07-25 09:00:00",
			notice_title: "示例通知",
			notice_type: "5",
			notice_type_name: "办公通知",
			organization_name: "教务处",
			schema_version: "internal_portal_notice_source.v1",
		});
		expect(source.attachments.map((attachment) => attachment.notice_annex_id)).toEqual([
			"annex-2",
			"annex-1",
			"annex-1",
		]);
	});

	it("rejects a detail payload for a different id", () => {
		expect(() =>
			buildInternalPortalNoticeSource({
				detailInfo: { notice_id: 355120, notice_title: "错误通知" },
				noticeId: 355119,
				siteId: "muc_internal_portal",
			}),
		).toThrow("detail returned notice_id 355120");
	});

	it("does not fill a missing detail type name from list metadata", () => {
		const source = buildInternalPortalNoticeSource({
			detailInfo: { notice_id: 355119, notice_title: "示例通知" },
			noticeId: 355119,
			siteId: "muc_internal_portal",
		});

		expect(source).toMatchObject({
			notice_content: null,
			notice_release_time: null,
			notice_type_name: null,
			organization_name: null,
		});
	});

	it("creates a new object at the stable source-bucket key", async () => {
		const createOrVerifyObject = vi.fn(async () => ({ byteSize: 1, contentSha256: "a" }));
		const store = createInternalPortalNoticeSourceStore({
			objectStore: objectStore({ createOrVerifyObject }),
		});
		const source = sourceFixture();

		await expect(store.put(source)).resolves.toBe("written");

		const key = internalPortalNoticeSourceObjectKey(source.site_id, source.notice_id);
		expect(createOrVerifyObject).toHaveBeenCalledWith(
			expect.objectContaining({
				bucket: "campus-agent-source",
				contentType: "application/json",
				key,
			}),
		);
	});

	it("reuses only an identical valid object", async () => {
		const source = sourceFixture();
		const createOrVerifyObject = vi.fn();
		const store = createInternalPortalNoticeSourceStore({
			objectStore: objectStore({
				createOrVerifyObject,
				getObjectIfExists: async () => jsonBytes(source),
			}),
		});

		await expect(store.put(source)).resolves.toBe("reused");
		expect(createOrVerifyObject).not.toHaveBeenCalled();
	});

	it.each([
		{
			error: "not valid JSON",
			stored: new TextEncoder().encode("not-json"),
		},
		{
			error: "identity does not match object key",
			stored: jsonBytes({ ...sourceFixture(), notice_id: 355120 }),
		},
		{
			error: "source differs from the stored object",
			stored: jsonBytes({ ...sourceFixture(), notice_title: "门户后来返回的标题" }),
		},
	])("fails without replacing an invalid or changed stored object", async ({ error, stored }) => {
		const createOrVerifyObject = vi.fn();
		const store = createInternalPortalNoticeSourceStore({
			objectStore: objectStore({
				createOrVerifyObject,
				getObjectIfExists: async () => stored,
			}),
		});

		await expect(store.put(sourceFixture())).rejects.toThrow(error);
		expect(createOrVerifyObject).not.toHaveBeenCalled();
	});

	it("encodes the site identity without key collisions", () => {
		expect(internalPortalNoticeSourceObjectKey("site:a", 1)).toBe(
			"internal_portal/site%3Aa/notices/1.json",
		);
		expect(internalPortalNoticeSourceObjectKey("site:a", 1)).not.toBe(
			internalPortalNoticeSourceObjectKey("site_a", 1),
		);
	});
});

function sourceFixture() {
	return buildInternalPortalNoticeSource({
		detailInfo: {
			notice_id: 355119,
			notice_title: "示例通知",
			notice_type_name: "办公通知",
		},
		noticeId: 355119,
		siteId: "muc_internal_portal",
	});
}

function jsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function objectStore(
	overrides: Partial<SourceCollectorObjectStore> = {},
): SourceCollectorObjectStore {
	return {
		createOrVerifyObject: async () => ({ byteSize: 0, contentSha256: "a" }),
		createOrVerifyStream: async () => {
			throw new Error("unexpected stream write");
		},
		getObject: async () => new Uint8Array(),
		getObjectIfExists: async () => null,
		putObject: async () => ({ byteSize: 0, contentSha256: "a" }),
		sourceBucket: "campus-agent-source",
		...overrides,
	};
}
