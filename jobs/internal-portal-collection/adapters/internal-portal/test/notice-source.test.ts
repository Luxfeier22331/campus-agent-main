import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import {
	buildInternalPortalNoticeSource,
	createInternalPortalNoticeSourceStore,
	internalPortalNoticeSourceObjectKey,
} from "../src/notice-source.js";

describe("internal portal notice source", () => {
	it("builds the 358159 source contract without repeated names or generated URLs", () => {
		const source = buildInternalPortalNoticeSource({
			detailInfo: {
				notice_annext: [],
				notice_content: " <p>自即日起暂时关闭海淀校区东北门。</p> ",
				notice_id: 358159,
				notice_release_time: " 2026-08-03 11:57 ",
				notice_title: " 关于暂时关闭校园东北门的通知 ",
				notice_type_name: "办公通知",
				organization_name: "党委保卫部、保卫处",
			},
			listItem: {
				notice_id: 358159,
				notice_link: null,
				notice_type: 5,
				organization_id: "00007",
				organization_name: "党委保卫部、保卫处",
			},
			noticeId: 358159,
			noticeType: 5,
		});

		expect(source).toEqual({
			attachments: [],
			external_url: null,
			is_external: false,
			notice_content_html: "<p>自即日起暂时关闭海淀校区东北门。</p>",
			notice_id: 358159,
			notice_release_time: "2026-08-03 11:57",
			notice_title: "关于暂时关闭校园东北门的通知",
			notice_type: 5,
			organization_id: "00007",
			schema_version: "internal_portal_notice_source.v2",
		});
	});

	it("marks a notice with a portal-provided HTTP URL as external", () => {
		const source = buildInternalPortalNoticeSource({
			detailInfo: {
				notice_content: null,
				notice_id: 358156,
				notice_title: "活动报道",
			},
			listItem: {
				notice_id: 358156,
				notice_link: " https://mp.weixin.qq.com/s/example ",
				notice_type: 36,
			},
			noticeId: 358156,
			noticeType: 36,
		});

		expect(source).toMatchObject({
			external_url: "https://mp.weixin.qq.com/s/example",
			is_external: true,
			notice_content_html: null,
		});
	});

	it("keeps attachment metadata in portal order including duplicates", () => {
		const source = buildInternalPortalNoticeSource({
			detailInfo: {
				notice_annext: [
					{
						notice_annex_id: " annex-1 ",
						notice_annex_name: " 附件.pdf ",
						notice_annex_path: " /download/1 ",
						suffix: " pdf ",
						type: " application/pdf ",
					},
					{
						notice_annex_id: " annex-1 ",
						notice_annex_name: " 附件.pdf ",
						notice_annex_path: " /download/1 ",
						suffix: " pdf ",
						type: " application/pdf ",
					},
				],
				notice_id: 358159,
				notice_title: "示例通知",
			},
			listItem: { notice_id: 358159, notice_type: 5 },
			noticeId: 358159,
			noticeType: 5,
		});

		expect(source.attachments.map((attachment) => attachment.notice_annex_id)).toEqual([
			"annex-1",
			"annex-1",
		]);
	});

	it("rejects mismatched detail ids and invalid external URLs", () => {
		expect(() =>
			buildInternalPortalNoticeSource({
				detailInfo: { notice_id: 358160, notice_title: "错误通知" },
				listItem: { notice_id: 358159, notice_type: 5 },
				noticeId: 358159,
				noticeType: 5,
			}),
		).toThrow("detail returned notice_id 358160");
		expect(() =>
			buildInternalPortalNoticeSource({
				detailInfo: { notice_id: 358159, notice_title: "错误通知" },
				listItem: { notice_id: 358159, notice_link: "ftp://example.edu", notice_type: 5 },
				noticeId: 358159,
				noticeType: 5,
			}),
		).toThrow("notice external URL must be an absolute HTTP or HTTPS URL");
	});

	it("writes and reuses the fixed notice key without a site layer", async () => {
		const createOrVerifyObject = vi.fn(async () => ({ byteSize: 1, contentSha256: "a" }));
		const source = sourceFixture();
		const store = createInternalPortalNoticeSourceStore({
			objectStore: objectStore({ createOrVerifyObject }),
		});

		await expect(store.has(source.notice_id)).resolves.toBe(false);
		await expect(store.put(source)).resolves.toBe("written");
		expect(createOrVerifyObject).toHaveBeenCalledWith(
			expect.objectContaining({
				bucket: "campus-agent-source",
				key: "internal_portal/notices/358159.json",
			}),
		);
		expect(internalPortalNoticeSourceObjectKey(358159)).toBe("internal_portal/notices/358159.json");
	});

	it.each([
		{ error: "not valid JSON", stored: new TextEncoder().encode("not-json") },
		{
			error: "identity does not match object key",
			stored: jsonBytes({ ...sourceFixture(), notice_id: 358160 }),
		},
	])("fails when an existing object is invalid", async ({ error, stored }) => {
		const store = createInternalPortalNoticeSourceStore({
			objectStore: objectStore({ getObjectIfExists: async () => stored }),
		});
		await expect(store.has(358159)).rejects.toThrow(error);
	});
});

function sourceFixture() {
	return buildInternalPortalNoticeSource({
		detailInfo: {
			notice_id: 358159,
			notice_title: "示例通知",
		},
		listItem: {
			notice_id: 358159,
			notice_type: 5,
			organization_id: "00007",
		},
		noticeId: 358159,
		noticeType: 5,
	});
}

function jsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function objectStore(
	overrides: Partial<InternalPortalCollectionObjectStore> = {},
): InternalPortalCollectionObjectStore {
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
