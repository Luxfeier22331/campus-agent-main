import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
	normalizePublishedNoticeContent,
	parseClassifications,
	publishNotices,
	resolveAssetContentType,
} from "../src/publisher.ts";
import { parsePortalReleaseTime } from "../src/time.ts";
import type { PublisherObjectStore } from "../src/store.ts";

describe("notice publisher inputs", () => {
	it("accepts one domain per notice", () => {
		expect(parseClassifications('{"notice_id":358159,"domain":"campus_operations"}\n')).toEqual([
			{ domain: "campus_operations", noticeId: 358159 },
		]);
	});
	it("rejects duplicates and unknown domains", () => {
		expect(() => parseClassifications('{"notice_id":1,"domain":"other"}\n')).toThrow(/invalid/u);
		expect(() => parseClassifications('{"notice_id":1,"domain":"campus_news"}\n{"notice_id":1,"domain":"campus_news"}\n')).toThrow(/duplicate/u);
	});
	it("converts portal Beijing time to an instant", () => {
		expect(parsePortalReleaseTime("2026-08-11 08:00:00")).toBe("2026-08-11T00:00:00.000Z");
	});
	it("does not project portal wrapper content for an external notice", () => {
		expect(
			normalizePublishedNoticeContent({
				html: '<p>门户摘要</p><img src="https://portal.example.edu/image.png">',
				isExternal: true,
				portalHost: "portal.example.edu",
				title: "外链通知",
			}),
		).toEqual({ contentHtml: null, contentText: null, images: [] });
	});
	it("uses the filename when object storage reports a generic media type", () => {
		expect(resolveAssetContentType("application/octet-stream;charset=utf-8", "附件.pdf")).toBe(
			"application/pdf",
		);
		expect(resolveAssetContentType("application/octet-stream", "申报材料.RAR")).toBe(
			"application/vnd.rar",
		);
		expect(resolveAssetContentType("image/png;charset=binary", "图片.bin")).toBe("image/png");
		expect(resolveAssetContentType("application/octet-stream", "未知附件.data")).toBe(
			"application/octet-stream",
		);
	});

	it("fails closed before writing when an attachment has no source identifier", async () => {
		const client = { query: vi.fn() } as unknown as PoolClient;
		const derived = vi.fn();
		const store = {
			close: vi.fn(),
			createOrVerifyDerived: derived,
			getSource: vi.fn(async (key: string) => ({
				body: Buffer.from(JSON.stringify(key.endsWith("meta.json") ? meta() : sourceWithoutAnnexId())),
				contentType: "application/json",
			})),
			listSource: vi.fn(async () => []),
		} as unknown as PublisherObjectStore;

		await expect(
			publishNotices({
				classifications: [{ domain: "campus_news", noticeId: 358159 }],
				client,
				objectStore: store,
				portalHost: "my.muc.edu.cn",
			}),
		).rejects.toThrow("notice 358159 attachment 0 has no notice_annex_id");
		expect(client.query).not.toHaveBeenCalled();
		expect(derived).not.toHaveBeenCalled();
	});
});

function meta() {
	return {
		notice_types: { "5": "办公通知" },
		organizations: {},
		schema_version: "internal_portal_meta.v1",
		updated_at: "2026-08-11T00:00:00.000Z",
	};
}

function sourceWithoutAnnexId() {
	return {
		attachments: [
			{
				notice_annex_id: null,
				notice_annex_name: "附件.pdf",
				notice_annex_path: "/storage/1",
				suffix: "pdf",
				type: "application/pdf",
			},
		],
		external_url: null,
		is_external: false,
		notice_content_html: "<p>正文</p>",
		notice_id: 358159,
		notice_release_time: "2026-08-11 08:00:00",
		notice_title: "测试通知",
		notice_type: 5,
		organization_id: null,
		schema_version: "internal_portal_notice_source.v2",
	};
}
