// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { AppApiRouteError } from "../src/http";
import type { NoticeDetailRecord, NoticeObjectStore, NoticeStore } from "../src/modules/notices";
import { buildNoticeService } from "../src/modules/notices";

function store(): NoticeStore {
	return {
		getDetail: vi.fn(
			async (): Promise<NoticeDetailRecord> => ({
				assets: [
					{
						byteSize: "256",
						contentSha256: "a".repeat(64),
						contentType: "image/png",
						kind: "image",
						name: null,
						ordinal: 0,
						portalAnnexId: null,
					},
					{
						byteSize: "1200",
						contentSha256: "b".repeat(64),
						contentType: "application/pdf",
						kind: "attachment",
						name: "附件.pdf",
						ordinal: 0,
						portalAnnexId: "annex-1",
					},
				],
				contentHtml: '<p>正文<img src="notice-asset:image:0" alt=""></p>',
				domain: "campus_operations",
				externalUrl: null,
				isExternal: false,
				noticeId: "358159",
				noticeType: { id: 5, name: "办公通知" },
				organization: { id: "100", name: "图书馆" },
				releasedAt: new Date("2026-08-11T00:00:00.000Z"),
				title: "关于暂停开放的通知",
			}),
		),
		getImageAsset: vi.fn(async () => ({
			byteSize: "256",
			contentSha256: "a".repeat(64),
			contentType: "image/png",
		})),
		list: vi.fn(async () => ({
			items: [
				{
					domain: "unclassified",
					externalUrl: "https://mp.weixin.qq.com/s/example",
					isExternal: true,
					noticeId: "358160",
					noticeType: { id: 5, name: "办公通知" },
					organization: null,
					releasedAt: "2026-08-10T00:00:00.000Z",
					title: "外链通知",
				},
			],
			noticeTypes: [{ id: 5, name: "办公通知" }],
			organizations: [{ id: "100", name: "图书馆" }],
			totalItems: 31,
		})),
	};
}

function objectStore(): NoticeObjectStore {
	return {
		get: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
	};
}

describe("notice service", () => {
	it("builds list options and preserves an external URL", async () => {
		const noticeStore = store();
		const service = buildNoticeService({ objectStore: objectStore(), store: noticeStore });
		const response = await service.list({ page: 2 });

		expect(response.items[0]).toMatchObject({
			domain: "unclassified",
			externalUrl: "https://mp.weixin.qq.com/s/example",
			isExternal: true,
			noticeId: "358160",
		});
		expect(response.filters.domains).toContainEqual({ label: "未分类", value: "unclassified" });
		expect(response.pagination).toEqual({
			page: 2,
			pageSize: 30,
			totalItems: 31,
			totalPages: 2,
		});
	});

	it("returns clean content and public asset metadata without digests", async () => {
		const service = buildNoticeService({ objectStore: objectStore(), store: store() });
		const response = await service.getDetail("358159");

		expect(response.images).toEqual([
			{
				byteSize: "256",
				contentType: "image/png",
				name: null,
				ordinal: 0,
				url: "/api/notices/358159/images/0",
			},
		]);
		expect(response.attachments).toEqual([
			{
				byteSize: "1200",
				contentType: "application/pdf",
				downloadUrl:
					"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex-1&notice_id=358159",
				name: "附件.pdf",
				ordinal: 0,
			},
		]);
		expect(JSON.stringify(response)).not.toContain("contentSha256");
		expect(JSON.stringify(response)).not.toContain("portalAnnexId");
	});

	it("rejects an attachment projection that has not been backfilled", async () => {
		const noticeStore = store();
		const detail = await noticeStore.getDetail("358159");
		if (!detail) {
			throw new Error("fixture detail is missing");
		}
		vi.mocked(noticeStore.getDetail).mockResolvedValue({
			...detail,
			assets: detail.assets.map((asset) =>
				asset.kind === "attachment" ? { ...asset, portalAnnexId: null } : asset,
			),
		});

		await expect(
			buildNoticeService({ objectStore: objectStore(), store: noticeStore }).getDetail("358159"),
		).rejects.toMatchObject({ code: "notice_projection_invalid", status: 500 });
	});

	it("checks image ownership before reading the digest object", async () => {
		const noticeStore = store();
		const noticeObjectStore = objectStore();
		const service = buildNoticeService({ objectStore: noticeObjectStore, store: noticeStore });
		const image = await service.readImage("358159", 0);

		expect(noticeStore.getImageAsset).toHaveBeenCalledWith("358159", 0);
		expect(noticeObjectStore.get).toHaveBeenCalledWith("a".repeat(64));
		expect(image.contentType).toBe("image/png");
		expect(new Uint8Array(await new Response(image.body).arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3]),
		);
	});

	it("returns the same not-found contract for missing details, ownership and objects", async () => {
		const missingStore = store();
		vi.mocked(missingStore.getDetail).mockResolvedValue(null);
		vi.mocked(missingStore.getImageAsset).mockResolvedValue(null);
		const missingObjects = objectStore();
		vi.mocked(missingObjects.get).mockResolvedValue(null);
		const service = buildNoticeService({ objectStore: missingObjects, store: missingStore });

		await expect(service.getDetail("358159")).rejects.toMatchObject({
			code: "notice_not_found",
			status: 404,
		});
		await expect(service.readImage("358159", 0)).rejects.toBeInstanceOf(AppApiRouteError);
		vi.mocked(missingStore.getImageAsset).mockResolvedValue({
			byteSize: "1",
			contentSha256: "a".repeat(64),
			contentType: "image/png",
		});
		await expect(service.readImage("358159", 0)).rejects.toMatchObject({ status: 404 });
	});
});
