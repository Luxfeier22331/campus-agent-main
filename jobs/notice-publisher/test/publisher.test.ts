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
	it("accepts one category per notice", () => {
		expect(
			parseClassifications('{"notice_id":358159,"category":"campus_operations"}\n'),
		).toEqual([
			{
				category: "campus_operations",
				noticeId: 358159,
			},
		]);
	});
	it("rejects missing, extra, old, and duplicate classifications", () => {
		expect(() => parseClassifications("null\n")).toThrow(/invalid/u);
		expect(() => parseClassifications("[]\n")).toThrow(/invalid/u);
		expect(() => parseClassifications('{"notice_id":1}\n')).toThrow(/invalid/u);
		expect(() => parseClassifications('{"notice_id":1,"domain":"procurement"}\n')).toThrow(
			/invalid/u,
		);
		expect(() =>
			parseClassifications('{"notice_id":1,"category":"procurement","note":"x"}\n'),
		).toThrow(/invalid/u);
		expect(() =>
			parseClassifications(
				'{"notice_id":1,"category":"procurement"}\n{"notice_id":1,"category":"procurement"}\n',
			),
		).toThrow(/duplicate/u);
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
				classifications: [{ category: "campus_operations", noticeId: 358159 }],
				client,
				noticeIds: [358159],
				objectStore: store,
				portalHost: "my.muc.edu.cn",
			}),
		).rejects.toThrow("notice 358159 attachment 0 has no notice_annex_id");
		expect(client.query).not.toHaveBeenCalled();
		expect(derived).not.toHaveBeenCalled();
	});

	it("reads online classification artifacts and only copies images to derived storage", async () => {
		const queries: Array<{ params?: unknown[]; text: string }> = [];
		const client = {
			query: vi.fn(async (text: string, params?: unknown[]) => {
				queries.push({ params, text });
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		const image = Buffer.from("image-bytes");
		const attachment = Buffer.from("attachment-bytes");
		const store = onlineStore({ image, attachment });

		await expect(
			publishNotices({
				client,
				objectStore: store,
				portalHost: "my.muc.edu.cn",
			}),
		).resolves.toEqual({ assets: 2, notices: 1 });

		expect(store.createOrVerifyDerived).toHaveBeenCalledOnce();
		expect(store.createOrVerifyDerived).toHaveBeenCalledWith({
			body: image,
			contentType: "image/png",
			digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
		});
		expect(store.getSource).toHaveBeenCalledWith(
			"internal_portal/notices/358159/attachments/0",
		);
		expect(queries.map((item) => item.text)).toEqual([
			"BEGIN",
			expect.stringContaining("INSERT INTO notices.notice_types"),
			expect.stringContaining("SELECT notice_type"),
			expect.stringContaining("INSERT INTO notices.notices"),
			expect.stringContaining("SELECT asset_kind"),
			expect.stringContaining("INSERT INTO notices.notice_assets"),
			expect.stringContaining("INSERT INTO notices.notice_assets"),
			"COMMIT",
		]);
		const assetInserts = queries.filter((item) =>
			item.text.includes("INSERT INTO notices.notice_assets"),
		);
		expect(assetInserts.map((item) => item.params?.[1])).toEqual(["image", "attachment"]);
		expect(assetInserts.map((item) => item.params?.[5])).toEqual([
			image.byteLength,
			attachment.byteLength,
		]);
	});

	it("does not read resources declared by an external notice", async () => {
		const queries: Array<{ params?: unknown[]; text: string }> = [];
		const client = {
			query: vi.fn(async (text: string, params?: unknown[]) => {
				queries.push({ params, text });
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		const source = {
			...sourceWithoutAnnexId(),
			external_url: "https://example.edu/notice",
			is_external: true,
		};
		const store = {
			close: vi.fn(),
			createOrVerifyDerived: vi.fn(),
			getSource: vi.fn(async (key: string) => {
				if (key === "internal_portal/meta.json") {
					return { body: Buffer.from(JSON.stringify(meta())), contentType: "application/json" };
				}
				if (key === "internal_portal/notices/358159.json") {
					return { body: Buffer.from(JSON.stringify(source)), contentType: "application/json" };
				}
				throw new Error(`unexpected source read: ${key}`);
			}),
		} as unknown as PublisherObjectStore;

		await expect(
			publishNotices({
				classifications: [{ category: "campus_news", noticeId: 358159 }],
				client,
				noticeIds: [358159],
				objectStore: store,
				portalHost: "my.muc.edu.cn",
			}),
		).resolves.toEqual({ assets: 0, notices: 1 });

		expect(store.getSource).toHaveBeenCalledTimes(2);
		expect(store.createOrVerifyDerived).not.toHaveBeenCalled();
		const noticeInsert = queries.find((item) =>
			item.text.includes("INSERT INTO notices.notices"),
		);
		expect(noticeInsert?.params?.slice(5)).toEqual([
			true,
			"https://example.edu/notice",
			"campus_news",
			null,
			null,
		]);
		expect(
			queries.some((item) => item.text.includes("INSERT INTO notices.notice_assets")),
		).toBe(false);
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

function onlineStore(input: { image: Uint8Array; attachment: Uint8Array }): PublisherObjectStore {
	const source = {
		attachments: [
			{
				notice_annex_id: "annex-1",
				notice_annex_name: "附件.pdf",
				notice_annex_path: "/storage/1",
				suffix: "pdf",
				type: "application/pdf",
			},
		],
		external_url: null,
		is_external: false,
		notice_content_html: '<p>正文<img src="/images/one.png"></p>',
		notice_id: 358159,
		notice_release_time: "2026-08-11 08:00:00",
		notice_title: "测试通知",
		notice_type: 5,
		organization_id: null,
		schema_version: "internal_portal_notice_source.v2",
	};
	return {
		close: vi.fn(),
		createOrVerifyDerived: vi.fn(),
		getDerived: vi.fn(async (key: string) =>
			key === "notices/classifications/358159.json"
				? {
					body: Buffer.from(
						JSON.stringify({
							category: "campus_operations",
							notice_id: 358159,
							schema_version: "notice_classification.v1",
						}),
					),
					contentType: "application/json",
				}
				: null,
		),
		getSource: vi.fn(async (key: string) => {
			if (key === "internal_portal/meta.json") {
				return { body: Buffer.from(JSON.stringify(meta())), contentType: "application/json" };
			}
			if (key === "internal_portal/notices/358159.json") {
				return { body: Buffer.from(JSON.stringify(source)), contentType: "application/json" };
			}
			if (key === "internal_portal/notices/358159/images/0") {
				return { body: input.image, contentType: "image/png" };
			}
			if (key === "internal_portal/notices/358159/attachments/0") {
				return { body: input.attachment, contentType: "application/pdf" };
			}
			throw new Error(`missing source: ${key}`);
		}),
		listDerived: vi.fn(async () => ["notices/classifications/358159.json"]),
		listSource: vi.fn(async () => [
			"internal_portal/notices/358159.json",
			"internal_portal/notices/358159/images/0",
			"internal_portal/notices/358159/attachments/0",
			"internal_portal/notices/_state.json",
		]),
	};
}
